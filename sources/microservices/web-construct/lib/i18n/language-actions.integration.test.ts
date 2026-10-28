import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { appLanguage } from '@/lib/db/schema'
import { cleanupTestData, describeIntegration, unique } from './test-support/db-fixtures'

// The actions call requirePermission() (session-bound) and revalidatePath() (request-bound);
// neither exists in a Vitest process, so both are stubbed. The authorization
// path itself is covered by the E2E suite, which drives a real session.
vi.mock('@/lib/rbac/auth-guard', () => {
  const admin = { userId: '00000000-0000-4000-8000-0000000000a1', roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() }
  return {
    requirePermission: async () => admin,
    // Le scritture dei cataloghi sono dell'amministratore di piattaforma (MT5-DEC-17).
    requirePlatformAdmin: async () => ({ userId: admin.userId, email: 'platform-admin@example.test' }),
    requireAdministrator: async () => admin,
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => ({ user: { id: 'test' } }) }))

const { createLanguage, deleteLanguage, setDefaultLanguage, setLanguageActive, updateLanguage } =
  await import('./language-actions')

describeIntegration('language actions against the database', () => {
  let code: string
  let originalDefaultId: number

  // `app_language.code` is validated against `^[a-z]{2,3}$` (language-rules.ts) —
  // lowercase letters only, no digits. `unique()`'s base36 suffix can contain
  // digits, so they are folded into letters (0-9 → a-j) rather than sliced raw,
  // which a literal `t${unique().slice(-2)}` would occasionally produce (e.g.
  // "t08") and fail the very first `createLanguage` call with a validation error.
  beforeEach(async () => {
    code = unique().slice(-3).replace(/[0-9]/g, d => String.fromCharCode(97 + Number(d)))
    const [original] = await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage).where(eq(appLanguage.isDefault, true)))
    originalDefaultId = Number(original.id)
  })
  afterEach(async () => {
    await withGlobal(async tx => {
      await tx.update(appLanguage).set({ isDefault: false }).where(eq(appLanguage.isDefault, true))
      await tx.update(appLanguage).set({ isDefault: true }).where(eq(appLanguage.idLanguage, originalDefaultId))
    })
    await cleanupTestData()
  })

  const input = (over: Partial<{ code: string; locale: string; isActive: boolean }> = {}) => ({
    // Il locale deriva dal code invece di essere fisso: locale e' UNIQUE, e una riga
    // sopravvissuta a un run interrotto se lo prende e blocca ogni esecuzione futura.
    code, locale: `${code}-ZZ`, name: `zzz_i18n_test_${code}`, nativeName: `zzz_i18n_test_${code}`,
    isActive: true, ...over,
  })

  it('creates a language', async () => {
    expect(await createLanguage(input())).toEqual({ error: null })
    const [row] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(row.isActive).toBe(true)
    expect(row.isDefault).toBe(false)
  })

  it('rejects a duplicate code', async () => {
    await createLanguage(input())
    // Stesso code, locale DIVERSO ma comunque derivato: il rifiuto deve arrivare dal
    // code duplicato, e un 'zy-ZY' fisso potrebbe farlo arrivare dal locale.
    const second = await createLanguage(input({ locale: `${code}-ZY` }))
    expect(second.error).toMatch(/codice/i)
  })

  it('rejects an invalid locale', async () => {
    expect((await createLanguage(input({ locale: 'zzz' }))).error).toMatch(/locale/i)
  })

  it('updates a language', async () => {
    await createLanguage(input())
    const [row] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(await updateLanguage(Number(row.idLanguage), input({ isActive: false }))).toEqual({ error: null })
    const [after] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(after.isActive).toBe(false)
  })

  it('activates and deactivates a language', async () => {
    await createLanguage(input())
    const [row] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    await setLanguageActive(Number(row.idLanguage), false)
    const [off] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(off.isActive).toBe(false)
    await setLanguageActive(Number(row.idLanguage), true)
    const [on] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(on.isActive).toBe(true)
  })

  it('switches the default atomically, leaving exactly one default', async () => {
    await createLanguage(input())
    const [row] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    const [{ code: previousDefault }] = await withGlobal(tx => tx
      .select({ code: appLanguage.code }).from(appLanguage).where(eq(appLanguage.isDefault, true)))

    expect(await setDefaultLanguage(Number(row.idLanguage))).toEqual({ error: null })
    const defaults = await withGlobal(tx => tx.select({ code: appLanguage.code }).from(appLanguage).where(eq(appLanguage.isDefault, true)))
    expect(defaults).toHaveLength(1)
    expect(defaults[0].code).toBe(code)

    // Restore the original default before cleanup — deleting the default is refused.
    const [original] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, previousDefault)))
    await setDefaultLanguage(Number(original.idLanguage))
  })

  it('refuses to deactivate the default language', async () => {
    const [current] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.isDefault, true)))
    const result = await setLanguageActive(Number(current.idLanguage), false)
    expect(result.error).toMatch(/predefinita/i)
  })

  it('refuses to delete the default language', async () => {
    const [current] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.isDefault, true)))
    expect((await deleteLanguage(Number(current.idLanguage))).error).toMatch(/predefinita/i)
  })

  it('deletes a non-default language and cascades its values', async () => {
    await createLanguage(input())
    const [row] = await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))
    expect(await deleteLanguage(Number(row.idLanguage))).toEqual({ error: null })
    expect(await withGlobal(tx => tx.select().from(appLanguage).where(eq(appLanguage.code, code)))).toHaveLength(0)
  })
})
