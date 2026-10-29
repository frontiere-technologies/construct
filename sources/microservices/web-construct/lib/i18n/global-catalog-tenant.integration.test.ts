import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import LanguagesPage from '@/app/(protected)/(admin)/admin/languages/page'
import TranslationsPage from '@/app/(protected)/(admin)/admin/translations/page'
import PlatformLanguagesPage from '@/app/platform/languages/page'
import PlatformEditTranslationKeyPage from '@/app/platform/translations/[keyId]/edit/page'
import PlatformCreateTranslationKeyPage from '@/app/platform/translations/create/page'
import PlatformTranslationsPage from '@/app/platform/translations/page'
import { POST as platformLanguagesGrid } from '@/app/api/platform/languages-grid/route'
import { POST as platformTranslationsGrid } from '@/app/api/platform/translations-grid/route'
import { POST as tenantLanguagesGrid } from '@/app/api/i18n/languages-grid/route'
import { POST as tenantTranslationsGrid } from '@/app/api/i18n/translations-grid/route'
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
 * I cataloghi globali di lingue e traduzioni sono della piattaforma (MT5-DEC-17, MT5-DEC-24): le
 * scritture le fa solo l'amministratore di piattaforma, dalla console, senza bisogno di un tenant.
 * Gli amministratori dei tenant, quello del tenant predefinito compreso, li leggono e basta: ogni
 * azione di scrittura li rifiuta e le pagine non mostrano controlli di modifica. Il catalogo non
 * cambia a ogni rifiuto.
 *
 * Guardie, servizi e database sono veri; finti solo i confini di Next e di Auth.js (sessione,
 * intestazioni, cookie, `redirect`, `notFound`, `revalidatePath`, `cache`), come nei test fra
 * tenant (`lib/tenancy/cross-tenant-entry-points.integration.test.ts`).
 */
const mocks = vi.hoisted(() => ({ session: null as unknown, headers: new Headers() }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ auth: async () => mocks.session, unstable_update: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: async () => mocks.headers,
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
let platformAdmin: string
let languageId: number
let keyId: number

/** Un codice di lingua valido (`^[a-z]{2,3}$`) e nuovo a ogni chiamata. */
function languageCode(): string {
  return unique().slice(-3).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)))
}

function languageInput(code: string) {
  return { code, locale: `${code}-ZZ`, name: `${RUN}${code}`, nativeName: `${RUN}${code}`, isActive: true }
}

async function createPlatformAdmin(): Promise<string> {
  const [row] = await withOwner(tx => tx.insert(users)
    .values({ email: `zzz_gc_platform_${unique()}@example.test`, idUserStatus: 2, isPlatformAdmin: true })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
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

/** Un amministratore di piattaforma che non appartiene a nessun tenant: la sessione è in stato `none`. */
function signInAsPlatformAdmin(): void {
  mocks.session = {
    user: { id: platformAdmin, email: `${platformAdmin}@example.test`, accountActive: true, provider: 'credentials', tenantState: 'none', tenantId: null, isPlatformAdmin: true },
    expires: '2099-01-01T00:00:00.000Z',
  }
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

function gridRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', body: JSON.stringify({ page: 0, size: 50 }), headers: { 'content-type': 'application/json' },
  })
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

describeIntegration('global catalogs owned by the platform', () => {
  beforeAll(async () => {
    const [row] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${`zzz-gc-${unique()}`.slice(0, 40)}, 'ZZZ Cataloghi globali')::text as id`))
    other = tenantIdForTest(Number(row.id))
    createdTenants.push(other)
    adminOther = await createAdmin(other)
    adminDefault = await createAdmin(defaultTestTenant())
    platformAdmin = await createPlatformAdmin()

    // Una lingua non predefinita e una chiave, con un valore: le righe che i tentativi provano a cambiare.
    const code = languageCode()
    const [language] = await withGlobal(tx => tx.insert(appLanguage)
      .values({ ...languageInput(code), isDefault: false })
      .returning({ id: appLanguage.idLanguage }))
    languageId = Number(language.id)
    const created = await (async () => {
      signInAsPlatformAdmin()
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

  beforeEach(() => {
    mocks.session = null
    mocks.headers = new Headers({ host: 'construct.example.test' })
  })

  const writeAttempts = () => [
    () => createLanguage(languageInput(languageCode())),
    () => updateLanguage(languageId, { ...languageInput(languageCode()), isActive: false }),
    () => setLanguageActive(languageId, false),
    () => setDefaultLanguage(languageId),
    () => deleteLanguage(languageId),
    () => createTranslationKey({ key: testKey(`gc${unique()}.label`), description: null, namespace: 'zzz_i18n_test', module: null }),
    () => saveTranslations({
      keyId, keyVersion: 1, description: 'cambiata', namespace: 'zzz_i18n_test', module: null,
      values: [{ languageCode: 'it', value: 'cambiata', version: null }],
    }),
    () => deleteTranslationKey(keyId),
  ]

  it('a tenant admin can read languages and translations but every write is refused', async () => {
    for (const [label, userId, tenantId] of [['another tenant', () => adminOther, () => other], ['the default tenant', () => adminDefault, () => defaultTestTenant()]] as const) {
      signInAs(userId(), tenantId())
      const before = await catalogFingerprint()

      // Lettura: le pagine si aprono, senza controlli di modifica, e le griglie rispondono.
      const languages = childProps<{ canManage: boolean }>(await LanguagesPage(pageProps()))
      expect(languages.canManage, label).toBe(false)
      const translations = childProps<{ canEdit: boolean; canManageKeys: boolean }>(await TranslationsPage(pageProps()))
      expect(translations, label).toMatchObject({ canEdit: false, canManageKeys: false })
      expect((await tenantLanguagesGrid(gridRequest('/api/i18n/languages-grid'))).status, label).toBe(200)
      expect((await tenantTranslationsGrid(gridRequest('/api/i18n/translations-grid'))).status, label).toBe(200)

      // Scrittura: ogni azione rifiuta, e il catalogo non cambia.
      for (const attempt of writeAttempts()) await expect(attempt(), label).rejects.toThrow('Unauthorized')
      expect(await catalogFingerprint(), label).toEqual(before)

      // La console non è per loro: le sue pagine e le sue griglie rispondono come se non ci fossero.
      await expect(PlatformLanguagesPage(pageProps()), label).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(PlatformTranslationsPage(pageProps()), label).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(PlatformCreateTranslationKeyPage(pageProps()), label).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(PlatformEditTranslationKeyPage(pageProps(keyId)), label).rejects.toThrow('NEXT_NOT_FOUND')
      expect((await platformLanguagesGrid(gridRequest('/api/platform/languages-grid'))).status, label).toBe(403)
      expect((await platformTranslationsGrid(gridRequest('/api/platform/translations-grid'))).status, label).toBe(403)
    }
  }, 60_000)

  it('refuses a platform admin token claim that the database does not confirm', async () => {
    signInAs(adminOther, other)
    ;(mocks.session as { user: { isPlatformAdmin?: boolean } }).user.isPlatformAdmin = true
    const before = await catalogFingerprint()
    for (const attempt of writeAttempts()) await expect(attempt()).rejects.toThrow('Unauthorized')
    expect(await catalogFingerprint()).toEqual(before)
  }, 30_000)

  it('a platform admin without any tenant writes languages and translations from the console', async () => {
    signInAsPlatformAdmin()

    // Le pagine della console si aprono, con i controlli di modifica.
    const languages = childProps<{ canManage: boolean; gridEndpoint: string }>(await PlatformLanguagesPage(pageProps()))
    expect(languages).toMatchObject({ canManage: true, gridEndpoint: '/api/platform/languages-grid' })
    const translations = childProps<{ canEdit: boolean; canManageKeys: boolean; basePath: string }>(await PlatformTranslationsPage(pageProps()))
    expect(translations).toMatchObject({ canEdit: true, canManageKeys: true, basePath: '/platform/translations' })
    await expect(PlatformCreateTranslationKeyPage(pageProps())).resolves.toBeTruthy()
    await expect(PlatformEditTranslationKeyPage(pageProps(keyId))).resolves.toBeTruthy()
    expect((await platformLanguagesGrid(gridRequest('/api/platform/languages-grid'))).status).toBe(200)
    expect((await platformTranslationsGrid(gridRequest('/api/platform/translations-grid'))).status).toBe(200)

    const code = languageCode()
    expect(await createLanguage(languageInput(code))).toEqual({ error: null })
    const [created] = await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage).where(eq(appLanguage.code, code)))
    const createdId = Number(created.id)
    expect(await updateLanguage(createdId, { ...languageInput(code), isActive: false })).toEqual({ error: null })
    expect(await setLanguageActive(createdId, true)).toEqual({ error: null })
    expect(await deleteLanguage(createdId)).toEqual({ error: null })

    const saved = await saveTranslations({
      keyId, keyVersion: 1, description: 'scritta dalla console', namespace: 'zzz_i18n_test', module: null, values: [],
    })
    expect(saved).toEqual({ ok: true })
    const [key] = await withGlobal(tx => tx.select({ description: translationKey.description }).from(translationKey).where(eq(translationKey.idTranslationKey, keyId)))
    expect(key.description).toBe('scritta dalla console')
    expect(await deleteTranslationKey(keyId)).toEqual({ error: null })
  }, 30_000)
})
