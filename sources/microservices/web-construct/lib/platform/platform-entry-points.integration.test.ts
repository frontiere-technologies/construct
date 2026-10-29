import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, like, sql } from 'drizzle-orm'
import { inspectExports, listEntryPoints } from '@/guards/entry-point-inventory'
import { menuEntry, platformAuditEvent, role, tenantAuditEvent, tenantMembership, tenantSettings, translationKey, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform, withPlatform } from '@/lib/platform/db'
import { POST as auditGrid } from '@/app/api/platform/audit-grid/route'
import { POST as languagesGrid } from '@/app/api/platform/languages-grid/route'
import { POST as tenantsGrid } from '@/app/api/platform/tenants-grid/route'
import { POST as translationsGrid } from '@/app/api/platform/translations-grid/route'
import PlatformAdminsPage from '@/app/platform/admins/page'
import PlatformAuditPage from '@/app/platform/audit/page'
import PlatformLanguagesPage from '@/app/platform/languages/page'
import PlatformTenantsPage from '@/app/platform/page'
import PlatformTenantPage from '@/app/platform/tenants/[tenantId]/page'
import PlatformEditTranslationKeyPage from '@/app/platform/translations/[keyId]/edit/page'
import PlatformCreateTranslationKeyPage from '@/app/platform/translations/create/page'
import PlatformTranslationsPage from '@/app/platform/translations/page'
import { createLanguage, deleteLanguage, setDefaultLanguage, setLanguageActive, updateLanguage } from '@/lib/i18n/language-actions'
import { createTranslationKey, deleteTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { addPlatformAdmin, removePlatformAdmin } from './platform-admin-actions'
import { endSupport, startSupport } from './support-actions'
import { addTenantAdmin, addTenantHost, createTenant, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus } from './tenant-actions'
import { getTenantForPlatform, listTenantsForPlatform } from './tenant-service'

/**
 * Le porte della piattaforma contro il database vero (specifica 2026-10-26, MT5-DEC-1, MT5-DEC-3,
 * MT5-DEC-10, MT5-OK-2; Review Focus #1).
 *
 * Prima parte: ogni porta che l'inventario (`guards/entry-point-inventory.ts`) dichiara con
 * `requirePlatformAdmin`, `requirePlatformAdminPage` o `requireSupportExit` ha qui la sua chiamata, e
 * viene rifiutata a chi non è amministratore di piattaforma (nessuna sessione, un amministratore di
 * tenant il cui token dice il contrario, un membro semplice, un account disattivato), su un indirizzo
 * dedicato (404 a chiunque) e, tranne l'uscita, da una sessione in assistenza. Un rifiuto non apre
 * nemmeno l'identità di piattaforma (`withPlatform` osservato) e non cambia niente. Una porta nuova
 * senza chiamata qui fa fallire il test di copertura.
 *
 * Seconda parte (MT5-OK-2): senza un permesso valido la piattaforma non legge né scrive dati di un
 * tenant, e con un permesso entra solo nel tenant che l'ha concesso e solo fino alla scadenza.
 *
 * Finti sono solo i confini di Next e di Auth.js (sessione, intestazioni, `notFound`, `redirect`,
 * `unstable_update`), la posta e i componenti client. Guardie, servizi e database sono veri.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
  unstableUpdate: vi.fn(),
}))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ auth: async () => mocks.session, unstable_update: mocks.unstableUpdate }))
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
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/lib/mailer', () => ({ sendEmail: async () => undefined }))
vi.mock('@/components/platform/TenantsTableClient', () => ({ TenantsTableClient: () => null }))
vi.mock('@/components/platform/PlatformAdmins', () => ({ PlatformAdmins: () => null }))
vi.mock('@/components/platform/TenantDetail', () => ({ TenantDetail: () => null }))
vi.mock('@/components/audit/AuditTableClient', () => ({ AuditTableClient: () => null }))
vi.mock('@/components/i18n/languages/LanguagesTableClient', () => ({ default: () => null }))
vi.mock('@/components/i18n/translations/TranslationsTableClient', () => ({ TranslationsTableClient: () => null }))
vi.mock('@/components/i18n/translations/TranslationKeyForm', () => ({ TranslationKeyForm: () => null }))
// La porta vera, ma osservabile: un rifiuto non deve nemmeno aprirla.
vi.mock('@/lib/platform/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/platform/db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})

const MAIN_HOST = 'construct.example.test'
const PREFIX = 'zzz_pep_'
const MARK = `zzzpepmark${unique()}`
const PLATFORM_GUARDS = new Set(['requirePlatformAdmin', 'requirePlatformAdminPage', 'requireSupportExit'])

type Person = { id: string; email: string }
type Kind = 'page' | 'route' | 'action'

interface Door {
  /** L'export vero, confrontato con l'inventario. */
  entry: unknown
  /** Chiama la porta con argomenti ben formati, che se la guardia non rifiutasse toccherebbero il tenant `target`. */
  call: () => Promise<unknown>
  /** Chi la chiama da una sessione in assistenza passa (solo l'uscita). */
  worksInSupport?: boolean
}

const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
let target: TenantId
let dedicatedHost: string
let victimAdmin: Person
let someKeyId: number

const doorKey = (entry: { file: string; name: string }) => `${entry.file}#${entry.name}`

/** Le porte che l'inventario dichiara con una guardia della piattaforma, con il loro genere. */
function platformDoorsInInventory(): { key: string; kind: Kind; guard: string }[] {
  return listEntryPoints().flatMap(entry => {
    const guard = inspectExports(readFileSync(entry.file, 'utf8'), entry.file).declared[entry.name]
    return guard !== undefined && PLATFORM_GUARDS.has(guard) ? [{ key: doorKey(entry), kind: entry.kind, guard }] : []
  })
}

function gridRequest(path: string, body: unknown = { page: 0, size: 20 }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

const noParams = Promise.resolve({})
const language = { code: 'zq', locale: 'zq-ZZ', name: 'ZZZ prova', nativeName: 'ZZZ prova', isActive: true }
const NO_SUCH_ID = 999_999_999

// Argomenti ben formati: se una guardia non rifiutasse, queste chiamate scriverebbero davvero.
const DOORS: Record<string, Door> = {
  'app/api/platform/audit-grid/route.ts#POST': { entry: auditGrid, call: () => auditGrid(gridRequest('/api/platform/audit-grid', { page: 0, size: 20, scope: 'tenant', tenantId: Number(target) })) },
  'app/api/platform/languages-grid/route.ts#POST': { entry: languagesGrid, call: () => languagesGrid(gridRequest('/api/platform/languages-grid')) },
  'app/api/platform/tenants-grid/route.ts#POST': { entry: tenantsGrid, call: () => tenantsGrid(gridRequest('/api/platform/tenants-grid')) },
  'app/api/platform/translations-grid/route.ts#POST': { entry: translationsGrid, call: () => translationsGrid(gridRequest('/api/platform/translations-grid')) },
  'app/platform/admins/page.tsx#default': { entry: PlatformAdminsPage, call: () => PlatformAdminsPage() },
  'app/platform/audit/page.tsx#default': { entry: PlatformAuditPage, call: () => PlatformAuditPage({ searchParams: noParams }) },
  'app/platform/languages/page.tsx#default': { entry: PlatformLanguagesPage, call: () => PlatformLanguagesPage({ searchParams: noParams }) },
  'app/platform/page.tsx#default': { entry: PlatformTenantsPage, call: () => PlatformTenantsPage({ searchParams: noParams }) },
  'app/platform/tenants/[tenantId]/page.tsx#default': {
    entry: PlatformTenantPage, call: () => PlatformTenantPage({ params: Promise.resolve({ tenantId: String(target) }) }),
  },
  'app/platform/translations/[keyId]/edit/page.tsx#default': {
    entry: PlatformEditTranslationKeyPage,
    call: () => PlatformEditTranslationKeyPage({ params: Promise.resolve({ keyId: String(someKeyId) }), searchParams: noParams }),
  },
  'app/platform/translations/create/page.tsx#default': { entry: PlatformCreateTranslationKeyPage, call: () => PlatformCreateTranslationKeyPage({ searchParams: noParams }) },
  'app/platform/translations/page.tsx#default': { entry: PlatformTranslationsPage, call: () => PlatformTranslationsPage({ searchParams: noParams }) },
  'lib/i18n/language-actions.ts#createLanguage': { entry: createLanguage, call: () => createLanguage(language) },
  'lib/i18n/language-actions.ts#deleteLanguage': { entry: deleteLanguage, call: () => deleteLanguage(NO_SUCH_ID) },
  'lib/i18n/language-actions.ts#setDefaultLanguage': { entry: setDefaultLanguage, call: () => setDefaultLanguage(NO_SUCH_ID) },
  'lib/i18n/language-actions.ts#setLanguageActive': { entry: setLanguageActive, call: () => setLanguageActive(NO_SUCH_ID, false) },
  'lib/i18n/language-actions.ts#updateLanguage': { entry: updateLanguage, call: () => updateLanguage(NO_SUCH_ID, language) },
  'lib/i18n/translation-actions.ts#createTranslationKey': {
    entry: createTranslationKey,
    call: () => createTranslationKey({ key: `zzz_pep.sezione.${unique()}`, description: null, namespace: 'zzz_pep', module: null }),
  },
  'lib/i18n/translation-actions.ts#deleteTranslationKey': { entry: deleteTranslationKey, call: () => deleteTranslationKey(NO_SUCH_ID) },
  'lib/i18n/translation-actions.ts#saveTranslations': {
    entry: saveTranslations,
    call: () => saveTranslations({ keyId: NO_SUCH_ID, keyVersion: 1, description: null, namespace: 'zzz_pep', module: null, values: [] }),
  },
  'lib/platform/platform-admin-actions.ts#addPlatformAdmin': { entry: addPlatformAdmin, call: () => addPlatformAdmin(`${PREFIX}new_${unique()}@example.test`) },
  'lib/platform/platform-admin-actions.ts#removePlatformAdmin': { entry: removePlatformAdmin, call: () => removePlatformAdmin(victimAdmin.id) },
  'lib/platform/support-actions.ts#endSupport': { entry: endSupport, call: () => endSupport(), worksInSupport: true },
  'lib/platform/support-actions.ts#startSupport': { entry: startSupport, call: () => startSupport(Number(target), 'prova') },
  'lib/platform/tenant-actions.ts#addTenantAdmin': { entry: addTenantAdmin, call: () => addTenantAdmin(Number(target), `${PREFIX}ta_${unique()}@example.test`) },
  'lib/platform/tenant-actions.ts#addTenantHost': { entry: addTenantHost, call: () => addTenantHost(Number(target), `zzz-pep-${unique()}.example.test`, false) },
  'lib/platform/tenant-actions.ts#createTenant': {
    entry: createTenant,
    call: () => createTenant({ name: 'ZZZ prova', slug: `zzz-pep-new-${unique()}`.slice(0, 40), adminEmail: `${PREFIX}ct_${unique()}@example.test` }),
  },
  'lib/platform/tenant-actions.ts#removeTenantHost': { entry: removeTenantHost, call: () => removeTenantHost(Number(target), dedicatedHost) },
  'lib/platform/tenant-actions.ts#resendTenantInvite': { entry: resendTenantInvite, call: () => resendTenantInvite(Number(target), victimAdmin.id) },
  'lib/platform/tenant-actions.ts#setPrimaryHost': { entry: setPrimaryHost, call: () => setPrimaryHost(Number(target), dedicatedHost) },
  'lib/platform/tenant-actions.ts#setTenantStatus': { entry: setTenantStatus, call: () => setTenantStatus(Number(target), 'archived', 'prova') },
}

type SessionState = 'none' | 'choose' | 'ready' | 'support'

function sessionOf(who: Person, state: SessionState, tenantId: number | null, claimsPlatformAdmin = true) {
  return {
    user: {
      id: who.id, email: who.email, accountActive: true, tenantState: state,
      tenantId: state === 'ready' || state === 'support' ? tenantId : null, isPlatformAdmin: claimsPlatformAdmin,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function onHost(host: string): void {
  mocks.headers = new Headers({ host })
}

async function createUser(label: string, options: { platformAdmin?: boolean; status?: number } = {}): Promise<Person> {
  const email = `${PREFIX}${label}_${unique()}@example.test`
  const [row] = await withOwner(tx => tx.insert(users)
    .values({ email, idUserStatus: options.status ?? 2, authProvider: 'credentials', isPlatformAdmin: options.platformAdmin ?? false })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function createTenantFromTemplate(label: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-pep-${label}-${unique()}`.slice(0, 40)}, ${`ZZZ pep ${label}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function addMember(tenantId: TenantId, who: Person, admin: boolean): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: who.id, status: 'active' })
    await tx.insert(userRole).values({ userId: who.id, idRole: system.registered })
    if (admin) await tx.insert(userRole).values({ userId: who.id, idRole: system.tenantAdmin })
  })
}

/** I numeri che una porta della piattaforma che scrivesse cambierebbe: tenant, indirizzi, amministratori, registri, cataloghi. */
async function platformFootprint(): Promise<Record<string, string | null>> {
  const [row] = await withOwner(tx => tx.execute<Record<string, string | null>>(sql`
    select
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.tenant t) as tenants,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.tenant_host t) as hosts,
      (select md5(coalesce(string_agg(u.id::text || u.is_platform_admin::text || u.id_user_status::text, '|' order by u.id::text), ''))
         from public.users u where u.is_platform_admin or u.email like ${`${PREFIX}%`}) as people,
      (select count(*)::text from public.platform_audit_event) as platform_audit,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.app_language t) as languages,
      (select md5(coalesce(string_agg(t.id_translation_key::text || t.key, '|' order by t.id_translation_key), '')) from public.translation_key t) as keys,
      (select count(*)::text from public.password_set_tokens) as tokens`))
  return row
}

/** Quanto sta dentro un tenant, riga per riga: l'impronta di cui un'azione della piattaforma non deve cambiare niente senza permesso. */
async function tenantContentFootprint(tenantId: TenantId): Promise<Record<string, string>> {
  const tables = ['role', 'role_permission', 'role_functionality', 'menu_entry', 'user_role', 'tenant_membership', 'app_theme', 'tenant_settings', 'tenant_audit_event']
  const parts = tables.map(name => sql`(select md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
    from ${sql.identifier('public')}.${sql.identifier(name)} t) as ${sql.identifier(name)}`)
  const [row] = await withOwner(tx => tx.execute<Record<string, string>>(sql`select ${sql.join(parts, sql`, `)}`), tenantId)
  return row
}

beforeAll(async () => {
  target = await createTenantFromTemplate('target')
  dedicatedHost = `zzz-pep-${unique()}.example.test`
  await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${dedicatedHost}, ${target}, true)`))
  victimAdmin = await createUser('victim', { platformAdmin: true })
  await addMember(target, victimAdmin, true)
  const [key] = await withGlobal(tx => tx.select({ id: translationKey.idTranslationKey }).from(translationKey).limit(1))
  someKeyId = key.id
}, 90_000)

afterAll(async () => {
  const errors: unknown[] = []
  const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
  for (const id of createdTenants) await step(() => deleteTenantForTest(id))
  await step(() => withGlobal(tx => tx.delete(users).where(like(users.email, `${PREFIX}%`))))
  await step(() => closePlatform())
  await step(() => closeOwner())
  if (errors.length > 0) throw errors[0]
}, 90_000)

beforeEach(() => {
  mocks.session = null
  onHost(MAIN_HOST)
  mocks.unstableUpdate.mockReset().mockResolvedValue(null)
  vi.mocked(withPlatform).mockClear()
})

describe('the platform doors of the inventory', () => {
  const inventory = platformDoorsInInventory()

  it('finds the platform doors in the inventory, so the coverage below is not empty', () => {
    expect(inventory.length).toBeGreaterThanOrEqual(27)
    expect(inventory.filter(door => door.kind === 'page').length).toBeGreaterThanOrEqual(8)
    expect(inventory.filter(door => door.kind === 'route').length).toBeGreaterThanOrEqual(4)
    expect(inventory.filter(door => door.kind === 'action').length).toBeGreaterThanOrEqual(15)
  })

  it('declares every page and route under the console paths with a platform guard', () => {
    // Una pagina o una rotta della console dichiarata con una guardia più debole (o nessuna) non
    // uscirebbe dall'inventario di sopra: qui si guarda il percorso, non la guardia.
    const underConsole = listEntryPoints().filter(entry => /^app\/(api\/)?platform\//.test(entry.file))
    expect(underConsole.filter(entry => entry.kind === 'page').length).toBeGreaterThanOrEqual(8)
    expect(underConsole.filter(entry => entry.kind === 'route').length).toBeGreaterThanOrEqual(4)
    const weak = underConsole
      .filter(entry => {
        const declared = inspectExports(readFileSync(entry.file, 'utf8'), entry.file).declared[entry.name]
        return declared === undefined || !PLATFORM_GUARDS.has(declared)
      })
      .map(doorKey)
    expect(weak).toEqual([])
  })

  it('has a call for every platform door, and none for a door that is gone', () => {
    const known = new Set(inventory.map(door => door.key))
    expect(inventory.map(door => door.key).filter(key => !Object.hasOwn(DOORS, key))).toEqual([])
    expect(Object.keys(DOORS).filter(key => !known.has(key))).toEqual([])
  })

  it('every call exercises the export its key names', async () => {
    const mismatched: string[] = []
    for (const [key, { entry }] of Object.entries(DOORS)) {
      const [file, name] = key.split('#')
      const exported = await import(resolve(process.cwd(), file)) as Record<string, unknown>
      if (exported[name] !== entry) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('only the exit works in support, and only the exit is declared with requireSupportExit', () => {
    const exits = inventory.filter(door => door.guard === 'requireSupportExit').map(door => door.key)
    expect(exits).toEqual(Object.entries(DOORS).filter(([, door]) => door.worksInSupport).map(([key]) => key))
    expect(exits).toEqual(['lib/platform/support-actions.ts#endSupport'])
  })
})

describeIntegration('every platform door refuses who is not a platform administrator', () => {
  const inventory = platformDoorsInInventory()
  let tenantAdmin: Person
  let tenantMember: Person
  let deactivatedAdmin: Person
  let platformAdmin: Person
  let platformAdminOnlyInToken: Person

  beforeAll(async () => {
    tenantAdmin = await createUser('tadmin')
    tenantMember = await createUser('tmember')
    deactivatedAdmin = await createUser('deactivated', { platformAdmin: true, status: 1 })
    platformAdmin = await createUser('padmin', { platformAdmin: true })
    platformAdminOnlyInToken = await createUser('demoted')
    await addMember(defaultTestTenant(), tenantAdmin, true)
    await addMember(defaultTestTenant(), tenantMember, false)
  }, 60_000)

  /**
   * Chiama ogni porta e dice quali non hanno risposto come deve: la pagina con un 404, la rotta con
   * 403 (404 su un indirizzo dedicato, a chiunque), l'azione con un rifiuto `Unauthorized`.
   */
  async function refusalsMissing(options: { dedicated: boolean; skipSupportExit?: boolean }): Promise<string[]> {
    const wrong: string[] = []
    for (const { key, kind } of inventory) {
      const door = DOORS[key]
      if (options.skipSupportExit && door.worksInSupport) continue
      try {
        if (kind === 'route') {
          const status = ((await door.call()) as Response).status
          if (status !== (options.dedicated ? 404 : 403)) wrong.push(`${key}: status ${status}`)
        } else {
          await door.call()
          wrong.push(`${key}: answered`)
        }
      } catch (error) {
        const expected = kind === 'page' ? 'NEXT_NOT_FOUND' : 'Unauthorized'
        if (!(error instanceof Error) || error.message !== expected) wrong.push(`${key}: ${String(error)}`)
      }
    }
    return wrong
  }

  async function expectNothingOpenedAndNothingChanged(run: () => Promise<void>): Promise<void> {
    const before = await platformFootprint()
    const targetBefore = await tenantContentFootprint(target)
    await run()
    expect(vi.mocked(withPlatform)).not.toHaveBeenCalled()
    expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    expect(await platformFootprint()).toEqual(before)
    expect(await tenantContentFootprint(target)).toEqual(targetBefore)
  }

  it('refuses a visitor with no session', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      mocks.session = null
      expect(await refusalsMissing({ dedicated: false })).toEqual([])
    })
  }, 60_000)

  it('refuses a tenant administrator, whatever the token claims', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      for (const claim of [true, false]) {
        mocks.session = sessionOf(tenantAdmin, 'ready', Number(defaultTestTenant()), claim)
        expect(await refusalsMissing({ dedicated: false })).toEqual([])
      }
    })
  }, 60_000)

  it('refuses a member without admin rights, and a person with no tenant', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      mocks.session = sessionOf(tenantMember, 'ready', Number(defaultTestTenant()), true)
      expect(await refusalsMissing({ dedicated: false })).toEqual([])
      mocks.session = sessionOf(tenantMember, 'none', null, true)
      expect(await refusalsMissing({ dedicated: false })).toEqual([])
    })
  }, 60_000)

  it('refuses a token that still claims the attribute the database no longer has', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      mocks.session = sessionOf(platformAdminOnlyInToken, 'none', null, true)
      expect(await refusalsMissing({ dedicated: false })).toEqual([])
    })
  }, 60_000)

  it('refuses a platform administrator whose account is deactivated', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      mocks.session = sessionOf(deactivatedAdmin, 'none', null)
      expect(await refusalsMissing({ dedicated: false })).toEqual([])
    })
  }, 60_000)

  it('answers as if the console did not exist on a dedicated address, to a platform administrator too', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      onHost(dedicatedHost)
      for (const state of ['none', 'choose', 'ready'] as const) {
        mocks.session = sessionOf(platformAdmin, state, Number(defaultTestTenant()))
        expect(await refusalsMissing({ dedicated: true })).toEqual([])
      }
      mocks.session = sessionOf(tenantAdmin, 'ready', Number(defaultTestTenant()))
      expect(await refusalsMissing({ dedicated: true })).toEqual([])
      mocks.session = null
      expect(await refusalsMissing({ dedicated: true })).toEqual([])
    })
  }, 90_000)

  it('closes every door but the exit to a platform administrator who is in support', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      mocks.session = sessionOf(platformAdmin, 'support', Number(target))
      expect(await refusalsMissing({ dedicated: false, skipSupportExit: true })).toEqual([])
    })
  }, 60_000)

  it('the exit refuses everyone who is not a platform administrator, in support or not', async () => {
    await expectNothingOpenedAndNothingChanged(async () => {
      for (const who of [tenantAdmin, tenantMember, platformAdminOnlyInToken]) {
        mocks.session = sessionOf(who, 'support', Number(target))
        await expect(endSupport()).rejects.toThrow('Unauthorized')
        mocks.session = sessionOf(who, 'ready', Number(defaultTestTenant()))
        await expect(endSupport()).rejects.toThrow('Unauthorized')
      }
    })
  }, 60_000)

  it('lets the platform administrator through on the main address, so the refusals above are about who asks', async () => {
    mocks.session = sessionOf(platformAdmin, 'none', null)
    const pages = inventory.filter(door => door.kind === 'page')
    for (const { key } of pages) {
      await expect(DOORS[key].call(), key).resolves.toBeDefined()
    }
    const readRoutes = inventory.filter(door => door.kind === 'route')
    for (const { key } of readRoutes) {
      expect(((await DOORS[key].call()) as Response).status, key).toBe(200)
    }
    // Le azioni che scrivono hanno ciascuna i suoi test; qui basta che la guardia comune le lasci passare.
    const { requirePlatformAdmin, requireSupportExit } = await import('@/lib/rbac/auth-guard')
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ userId: platformAdmin.id })
    await expect(requireSupportExit()).resolves.toMatchObject({ userId: platformAdmin.id })
    // Dall'indirizzo principale in assistenza la guardia comune chiude, quella dell'uscita no.
    mocks.session = sessionOf(platformAdmin, 'support', Number(target))
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requireSupportExit()).resolves.toMatchObject({ userId: platformAdmin.id })
  }, 90_000)
})

// MT5-OK-2: senza un permesso di assistenza valido la piattaforma non legge né modifica dati di un
// tenant, salvo il modello; con il permesso entra solo nel tenant che l'ha concesso e solo fino alla
// scadenza. Contare persone e amministratori per l'elenco è ammesso (numeri ed email, non dati).
describeIntegration('the platform does not see inside a tenant without its consent (MT5-OK-2)', () => {
  let platformAdmin: Person
  let tenantA: TenantId
  let tenantB: TenantId
  let adminA: Person
  let adminB: Person
  let plainB: Person

  const adminOf = (tenantId: TenantId): Person => (tenantId === tenantB ? adminB : adminA)

  async function setConsent(tenantId: TenantId, until: 'valid' | 'expired' | 'none'): Promise<void> {
    const value = until === 'valid' ? sql`now() + interval '1 hour'` : until === 'expired' ? sql`now() - interval '1 minute'` : null
    // Come la concessione vera: scadenza, chi l'ha data e quando (un ingresso conta solo se è dopo la concessione).
    await withOwner(tx => tx.update(tenantSettings).set(value === null
      ? { supportUntil: null, supportGrantedBy: null, supportGrantedAt: null }
      : { supportUntil: value, supportGrantedBy: adminOf(tenantId).id, supportGrantedAt: sql`now() - interval '1 second'` }), tenantId)
  }

  const supportEntries = (tenantId: TenantId, operation: string) => withOwner(
    tx => tx.select({ id: tenantAuditEvent.id }).from(tenantAuditEvent).where(eq(tenantAuditEvent.operation, operation)), tenantId)
  const platformEntries = async (tenantId: TenantId, operation: string) => (await withOwner(
    tx => tx.select({ id: platformAuditEvent.id }).from(platformAuditEvent)
      .where(and(eq(platformAuditEvent.idTenant, tenantId), eq(platformAuditEvent.operation, operation))))).length

  beforeAll(async () => {
    platformAdmin = await createUser('ok2admin', { platformAdmin: true })
    tenantA = await createTenantFromTemplate('ok2a')
    tenantB = await createTenantFromTemplate('ok2b')
    adminB = await createUser('ok2adminb')
    plainB = await createUser('ok2plainb')
    adminA = await createUser('ok2admina')
    await addMember(tenantA, adminA, true)
    await addMember(tenantB, adminB, true)
    await addMember(tenantB, plainB, false)
    await withTenant(tenantB, async tx => {
      await tx.insert(role).values({ description: `${MARK} ruolo`, idRoleType: 2 })
      await tx.insert(menuEntry).values({ name: `${MARK} voce` })
    })
    await withOwner(tx => tx.insert(tenantAuditEvent).values({
      actorKind: 'person', actorEmail: `${PREFIX}${MARK}@example.test`, operation: 'role.create', objectType: 'role', objectId: MARK,
      details: { name: MARK },
    }), tenantB)
  }, 90_000)

  beforeEach(async () => {
    mocks.session = sessionOf(platformAdmin, 'none', null)
    await setConsent(tenantA, 'none')
    await setConsent(tenantB, 'none')
  })

  it('reads no tenant content in any listing, page or grid, only counts and the administrators emails', async () => {
    const serialize = (value: unknown) => JSON.stringify(value, (_key, current: unknown) => typeof current === 'bigint' ? current.toString() : current) ?? ''
    const listing = await listTenantsForPlatform({ page: 0, size: 200 })
    const detail = await getTenantForPlatform(Number(tenantB))
    const tenantPage = await PlatformTenantPage({ params: Promise.resolve({ tenantId: String(tenantB) }) })
    const everything = serialize([listing, detail, tenantPage])
    expect(everything).not.toContain(MARK)
    expect(everything).not.toContain(plainB.email)
    // Gli amministratori sì: numeri ed email, e solo quelli.
    expect(everything).toContain(adminB.email)

    for (const [route, path] of [[tenantsGrid, 'tenants-grid'], [auditGrid, 'audit-grid'], [languagesGrid, 'languages-grid'], [translationsGrid, 'translations-grid']] as const) {
      const response = await route(gridRequest(`/api/platform/${path}`, { page: 0, size: 100, search: MARK }))
      expect(response.status, path).toBe(200)
      expect(serialize(await response.json()), path).not.toContain(MARK)
    }
    // Nemmeno cercando la voce di registro di B per attore, e con il registro del modello.
    for (const scope of [{ scope: 'platform' }, { scope: 'template' }, { scope: 'tenant', tenantId: Number(tenantB) }]) {
      const response = await auditGrid(gridRequest('/api/platform/audit-grid', { page: 0, size: 200, ...scope }))
      expect(serialize(await response.json())).not.toContain(MARK)
    }
  }, 60_000)

  it('refuses support without consent, for every tenant, and writes nothing and moves no token', async () => {
    const before = await platformFootprint()
    const contentBefore = await tenantContentFootprint(tenantB)
    await expect(startSupport(Number(tenantB), 'senza permesso')).rejects.toThrow('support_not_allowed')
    // Un permesso scaduto vale come nessun permesso.
    await setConsent(tenantB, 'expired')
    await expect(startSupport(Number(tenantB), 'scaduto')).rejects.toThrow('support_not_allowed')
    // Un tenant sospeso non si assiste nemmeno con il permesso.
    await setConsent(tenantB, 'valid')
    await withOwner(tx => tx.execute(sql`update public.tenant set status = 'suspended' where id = ${tenantB}`))
    try {
      await expect(startSupport(Number(tenantB), 'sospeso')).rejects.toThrow('support_not_allowed')
    } finally {
      await withOwner(tx => tx.execute(sql`update public.tenant set status = 'active' where id = ${tenantB}`))
    }
    await setConsent(tenantB, 'none')

    expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    expect(await platformFootprint()).toEqual(before)
    expect(await tenantContentFootprint(tenantB)).toEqual({ ...contentBefore, tenant_settings: expect.any(String) })
    expect(await supportEntries(tenantB, 'support.enter')).toEqual([])
    expect(await platformEntries(tenantB, 'support.enter')).toBe(0)
  }, 60_000)

  it('the consent of one tenant opens that tenant only, and only until its expiry', async () => {
    await setConsent(tenantA, 'valid')
    mocks.unstableUpdate.mockResolvedValue({ user: { tenantState: 'support' } })
    const bBefore = await tenantContentFootprint(tenantB)

    // Il permesso di A non apre B.
    await expect(startSupport(Number(tenantB), 'preso da A')).rejects.toThrow('support_not_allowed')
    expect(mocks.unstableUpdate).not.toHaveBeenCalled()

    // Apre A, e solo A: l'ingresso sta nei due registri di A e in nessun registro di B.
    expect(await startSupport(Number(tenantA), 'verifica')).toEqual({ state: 'support' })
    expect(mocks.unstableUpdate).toHaveBeenCalledTimes(1)
    expect((await supportEntries(tenantA, 'support.enter')).length).toBe(1)
    expect(await supportEntries(tenantB, 'support.enter')).toEqual([])
    expect(await platformEntries(tenantA, 'support.enter')).toBe(1)
    expect(await platformEntries(tenantB, 'support.enter')).toBe(0)
    expect(await tenantContentFootprint(tenantB)).toEqual(bBefore)

    // Alla scadenza non entra più.
    await setConsent(tenantA, 'expired')
    mocks.unstableUpdate.mockClear()
    await expect(startSupport(Number(tenantA), 'dopo la scadenza')).rejects.toThrow('support_not_allowed')
    expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    expect((await supportEntries(tenantA, 'support.enter')).length).toBe(1)
  }, 60_000)

  it('a platform admin signed in as a member of no tenant has no authority inside any tenant', async () => {
    // La stessa persona, senza permesso e senza appartenenza: le porte dei tenant la rifiutano.
    const { requirePermission } = await import('@/lib/rbac/auth-guard')
    // Un tenant nuovo: l'ingresso aperto da un altro test non conta come ingresso di questo.
    const tenantC = await createTenantFromTemplate('ok2c')
    for (const tenantId of [tenantC, tenantB]) {
      mocks.session = sessionOf(platformAdmin, 'ready', Number(tenantId))
      await expect(requirePermission('read-users')).rejects.toThrow('Unauthorized')
      mocks.session = sessionOf(platformAdmin, 'support', Number(tenantId))
      await expect(requirePermission('read-users')).rejects.toThrow('Unauthorized')
    }
    await setConsent(tenantC, 'valid')
    // Il permesso da solo non basta: serve l'ingresso scritto da startSupport.
    mocks.session = sessionOf(platformAdmin, 'support', Number(tenantC))
    await expect(requirePermission('read-users')).rejects.toThrow('Unauthorized')
    mocks.unstableUpdate.mockResolvedValue({ user: { tenantState: 'support' } })
    mocks.session = sessionOf(platformAdmin, 'none', null)
    await startSupport(Number(tenantC), 'verifica')
    mocks.session = sessionOf(platformAdmin, 'support', Number(tenantC))
    await expect(requirePermission('read-users')).resolves.toMatchObject({ support: true, tenantId: tenantC })
    // Il permesso di C non dà autorità in B, nemmeno con un token che dice B.
    mocks.session = sessionOf(platformAdmin, 'support', Number(tenantB))
    await expect(requirePermission('read-users')).rejects.toThrow('Unauthorized')
    // E la lettura dei dati di B con l'identità di piattaforma, senza dire il tenant, è negata dal database.
    const refusal = await withPlatform(tx => tx.select({ id: role.idRole }).from(role)).then(() => null, (error: unknown) => error)
    expect(refusal, 'the platform identity read tenant rows without a tenant').not.toBeNull()
    // Drizzle avvolge l'errore di Postgres: il messaggio vero è nella catena delle cause.
    const messages: string[] = []
    for (let current: unknown = refusal; current && typeof current === 'object'; current = (current as { cause?: unknown }).cause) {
      messages.push(String((current as { message?: unknown }).message))
    }
    expect(messages.join('\n')).toContain('tenant context missing')
  }, 60_000)
})
