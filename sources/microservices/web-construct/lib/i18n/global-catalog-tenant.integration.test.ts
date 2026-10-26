import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import LanguagesPage from '@/app/(protected)/(admin)/admin/languages/page'
import EditTranslationKeyPage from '@/app/(protected)/(admin)/admin/translations/[keyId]/edit/page'
import CreateTranslationKeyPage from '@/app/(protected)/(admin)/admin/translations/create/page'
import TranslationsPage from '@/app/(protected)/(admin)/admin/translations/page'
import { appLanguage, tenantMembership, translationKey, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import {
  createLanguage, deleteLanguage, setDefaultLanguage, setLanguageActive, updateLanguage,
} from './language-actions'
import { createTranslationKey, deleteTranslationKey, saveTranslations } from './translation-actions'
import { cleanupTestData, describeIntegration, TEST_PREFIX, testKey, unique } from './test-support/db-fixtures'

/**
 * I cataloghi globali di lingue e traduzioni si scrivono solo dal tenant predefinito, fino al
 * pezzo 5 (MT2-DEC-11; specifica 2026-10-21, §5.3). Un amministratore di un altro tenant riceve lo
 * stesso rifiuto di chi non ha il permesso, su ogni azione e pagina di scrittura, e il catalogo non
 * cambia; la lettura resta. L'amministratore del tenant predefinito scrive come prima.
 *
 * Guardie, servizi e database sono veri; finti solo i confini di Next e di Auth.js (sessione,
 * intestazioni, cookie, `redirect`, `notFound`, `revalidatePath`, `cache`), come nei test fra
 * tenant (`lib/tenancy/cross-tenant-entry-points.integration.test.ts`).
 */
const mocks = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ auth: async () => mocks.session, unstable_update: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => undefined }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('next/cache', async importOriginal => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidatePath: () => undefined,
}))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

// Dentro il prefisso dei dati di prova, così cleanupTestData li trova anche dopo un'interruzione.
const RUN = `${TEST_PREFIX}gc${unique()}_`

let other: TenantId
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
let adminOther: string
let adminDefault: string
let languageId: number
let keyId: number

/** Un codice di lingua valido (`^[a-z]{2,3}$`) e nuovo a ogni chiamata. */
function languageCode(): string {
  return unique().slice(-3).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)))
}

function languageInput(code: string) {
  return { code, locale: `${code}-ZZ`, name: `${RUN}${code}`, nativeName: `${RUN}${code}`, isActive: true }
}

async function createAdmin(tenantId: TenantId): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_gc_${unique()}@example.test`, idUserStatus: 2 })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: row.id, status: 'active' })
    await tx.insert(userRole).values([{ userId: row.id, idRole: system.registered }, { userId: row.id, idRole: system.tenantAdmin }])
  })
  return row.id
}

function signInAs(userId: string, tenantId: TenantId): void {
  mocks.session = {
    user: { id: userId, email: `${userId}@example.test`, accountActive: true, provider: 'credentials', tenantState: 'ready', tenantId: Number(tenantId), tenantName: 'ZZZ' },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

/** L'impronta dei tre cataloghi globali, intera: nessuna riga cambiata, aggiunta o tolta. */
async function catalogFingerprint(): Promise<Record<string, string>> {
  const [row] = await withGlobal(tx => tx.execute<Record<string, string>>(sql`
    select
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.app_language t) as languages,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.translation_key t) as keys,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.translation_value t) as "values"
  `))
  return row
}

function pageProps(keyIdValue?: number) {
  return {
    params: Promise.resolve({ keyId: String(keyIdValue ?? 0) }),
    searchParams: Promise.resolve({}),
  }
}

/** Le props del primo figlio di un elemento React restituito da una pagina (il client della tabella). */
function childProps<T>(element: unknown): T {
  return (element as { props: { children: { props: T } } }).props.children.props
}

describeIntegration('global catalogs writable only from the default tenant', () => {
  beforeAll(async () => {
    const [row] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${`zzz-gc-${unique()}`.slice(0, 40)}, 'ZZZ Cataloghi globali')::text as id`))
    other = tenantIdForTest(Number(row.id))
    createdTenants.push(other)
    adminOther = await createAdmin(other)
    adminDefault = await createAdmin(defaultTestTenant())

    // Una lingua non predefinita e una chiave, con un valore: le righe che i tentativi provano a cambiare.
    const code = languageCode()
    const [language] = await withGlobal(tx => tx.insert(appLanguage)
      .values({ ...languageInput(code), isDefault: false })
      .returning({ id: appLanguage.idLanguage }))
    languageId = Number(language.id)
    const created = await (async () => {
      signInAs(adminDefault, defaultTestTenant())
      return createTranslationKey({ key: testKey(`gc${unique()}.label`), description: null, namespace: 'zzz_i18n_test', module: null })
    })()
    if (created.error || created.id === undefined) throw new Error(`setup: createTranslationKey failed: ${created.error}`)
    keyId = created.id
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    await step(() => cleanupTestData())
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  beforeEach(() => { mocks.session = null })

  it('refuses every write action to an administrator of another tenant, and the catalog does not change', async () => {
    signInAs(adminOther, other)
    const before = await catalogFingerprint()

    await expect(createLanguage(languageInput(languageCode()))).rejects.toThrow('Unauthorized')
    await expect(updateLanguage(languageId, { ...languageInput(languageCode()), isActive: false })).rejects.toThrow('Unauthorized')
    await expect(setLanguageActive(languageId, false)).rejects.toThrow('Unauthorized')
    await expect(setDefaultLanguage(languageId)).rejects.toThrow('Unauthorized')
    await expect(deleteLanguage(languageId)).rejects.toThrow('Unauthorized')
    await expect(createTranslationKey({ key: testKey(`gc${unique()}.label`), description: null, namespace: 'zzz_i18n_test', module: null }))
      .rejects.toThrow('Unauthorized')
    await expect(saveTranslations({
      keyId, keyVersion: 1, description: 'cambiata', namespace: 'zzz_i18n_test', module: null,
      values: [{ languageCode: 'it', value: 'cambiata', version: null }],
    })).rejects.toThrow('Unauthorized')
    await expect(deleteTranslationKey(keyId)).rejects.toThrow('Unauthorized')

    expect(await catalogFingerprint()).toEqual(before)
  }, 30_000)

  it('sends an administrator of another tenant away from the write pages, and keeps the read pages without write controls', async () => {
    signInAs(adminOther, other)
    await expect(CreateTranslationKeyPage(pageProps())).rejects.toThrow('NEXT_REDIRECT:/')
    await expect(EditTranslationKeyPage(pageProps(keyId))).rejects.toThrow('NEXT_REDIRECT:/')

    const languages = childProps<{ canManage: boolean }>(await LanguagesPage(pageProps()))
    expect(languages.canManage).toBe(false)
    const translations = childProps<{ canEdit: boolean; canManageKeys: boolean }>(await TranslationsPage(pageProps()))
    expect(translations).toMatchObject({ canEdit: false, canManageKeys: false })
  }, 30_000)

  it('lets the administrator of the default tenant write the catalogs and open the write pages', async () => {
    signInAs(adminDefault, defaultTestTenant())

    const languages = childProps<{ canManage: boolean }>(await LanguagesPage(pageProps()))
    expect(languages.canManage).toBe(true)
    const translations = childProps<{ canEdit: boolean; canManageKeys: boolean }>(await TranslationsPage(pageProps()))
    expect(translations).toMatchObject({ canEdit: true, canManageKeys: true })
    await expect(CreateTranslationKeyPage(pageProps())).resolves.toBeTruthy()
    await expect(EditTranslationKeyPage(pageProps(keyId))).resolves.toBeTruthy()

    const code = languageCode()
    expect(await createLanguage(languageInput(code))).toEqual({ error: null })
    const [created] = await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage).where(eq(appLanguage.code, code)))
    const createdId = Number(created.id)
    expect(await updateLanguage(createdId, { ...languageInput(code), isActive: false })).toEqual({ error: null })
    expect(await setLanguageActive(createdId, true)).toEqual({ error: null })
    expect(await deleteLanguage(createdId)).toEqual({ error: null })

    const saved = await saveTranslations({
      keyId, keyVersion: 1, description: 'scritta dal predefinito', namespace: 'zzz_i18n_test', module: null, values: [],
    })
    expect(saved).toEqual({ ok: true })
    const [key] = await withGlobal(tx => tx.select({ description: translationKey.description }).from(translationKey).where(eq(translationKey.idTranslationKey, keyId)))
    expect(key.description).toBe('scritta dal predefinito')
    expect(await deleteTranslationKey(keyId)).toEqual({ error: null })
  }, 30_000)
})
