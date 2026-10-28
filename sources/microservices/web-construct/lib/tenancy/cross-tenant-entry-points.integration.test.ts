import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { listEntryPoints } from '@/guards/entry-point-inventory'
import EditFunctionalityPage from '@/app/(protected)/(admin)/functionalities/[funcId]/edit/page'
import CreateFunctionalityPage from '@/app/(protected)/(admin)/functionalities/create/page'
import FunctionalitiesPage from '@/app/(protected)/(admin)/functionalities/page'
import RoleDetailPage from '@/app/(protected)/(admin)/roles-permissions/[roleId]/page'
import RolesPage from '@/app/(protected)/(admin)/roles-permissions/page'
import UserManagementPage from '@/app/(protected)/(admin)/user-management/page'
import TenantSettingsPage from '@/app/(protected)/(admin)/admin/tenant-settings/page'
import ThemePage from '@/app/(protected)/(admin)/admin/theme/page'
import EmbeddedItemPage from '@/app/(protected)/embedded/[itemId]/page'
import SelectTenantPage from '@/app/select-tenant/page'
import { POST as sendInvite } from '@/app/api/admin/send-invite/route'
import { POST as tenantAuditGrid } from '@/app/api/audit/tenant-grid/route'
import { POST as rolesGrid } from '@/app/api/rbac/roles-grid/route'
import { POST as usersGrid } from '@/app/api/rbac/users-grid/route'
import { appTheme, menuEntry, role, roleFunctionality, tenantAuditEvent, tenantMembership, tenantSettings, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { createNavigationItem, deleteNavigationItem, moveNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import { createRole, deleteRole, renameRole, updateRolePermissions } from '@/lib/rbac/roles-actions'
import { FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK, USER_STATUS_DEACTIVATED, type CreateNavItemInput } from '@/lib/rbac/types'
import { addUserByEmail, setUserStatus, updateUserRoles } from '@/lib/rbac/users-actions'
import PlatformTenantPage from '@/app/platform/tenants/[tenantId]/page'
import {
  addTenantAdmin, addTenantHost, createTenant as createPlatformTenant, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus,
} from '@/lib/platform/tenant-actions'
import { saveAppTheme } from '@/lib/theme-actions'
import { endSupport, startSupport } from '@/lib/platform/support-actions'
import { getSystemRoleIds } from './system-roles'
import { chooseTenant } from './tenant-actions'
import { setSelfRegistration } from './tenant-settings-actions'
import { grantSupportConsent, revokeSupportConsent } from './support-consent-actions'
import { tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Nessun ingresso attraversa i tenant (specifica 2026-10-21, §4 «Fra tenant su ogni ingresso»,
 * DEF-4.4, MT4-OK-4, MT4-RISK-4). Per ogni porta dell'inventario (`guards/entry-point-inventory.ts`:
 * azioni del server, rotte di `app/api`, pagine per chi ha fatto l'accesso) c'è qui un caso oppure
 * un'esenzione con il motivo; una porta nuova senza né l'uno né l'altra fa fallire il primo test.
 *
 * Un caso chiama la porta vera, nello stesso processo, con la sessione di un amministratore del
 * tenant A e gli id delle righe del tenant B (persone, ruoli, voci di menu, la chiave del tenant).
 * Finti sono solo i confini di Next e di Auth.js: la sessione, le intestazioni, `redirect`,
 * `notFound`, `revalidatePath` e `unstable_update`. Servizi, guardie dei permessi e database sono
 * veri. Ogni caso controlla l'esito che vede il chiamante (rifiuto, 404, `notFound`, redirect, o
 * una risposta senza niente di B) e, attorno a ogni caso, l'impronta di B letta come proprietario
 * deve restare identica: nessuna riga di B cambiata, aggiunta o tolta.
 *
 * Le verifiche via HTTP vero (un token di B presentato su un indirizzo dove B non risponde) sono
 * negli E2E del Task 11.
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
  // Nessun cookie: lingua e aspetto si risolvono dai valori predefiniti.
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => undefined }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  // Come in Next, redirect e notFound lanciano: qui con un messaggio che dice quale e dove.
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

/** Una porta e il suo caso: `entry` è l'export vero, confrontato con l'inventario; `arrange` prepara lo stato prima dell'impronta. */
interface CrossTenantCase {
  entry: unknown
  arrange?: () => Promise<void>
  run: () => Promise<void>
}

/**
 * Le porte che non hanno un caso, ciascuna con il motivo. Un'esenzione vale solo per una porta che
 * non riceve id di righe di tenant e non legge né scrive righe di tenant: per tutte le altre serve
 * un caso.
 */
const PERSONAL = 'preferenze personali: agisce solo sulla riga globale della persona della sessione, senza id e senza righe di tenant'
const GLOBAL_LANGUAGES = 'catalogo globale delle lingue (MT2-DEC-11, DEF-2.4): gli id sono di righe globali, non esistono righe di B da chiedere'
const GLOBAL_TRANSLATIONS = 'catalogo globale delle traduzioni (MT2-DEC-11, DEF-2.4): gli id sono di righe globali, non esistono righe di B da chiedere'
// Le scritture dei cataloghi globali sono dell'amministratore di piattaforma (MT5-DEC-17,
// MT5-DEC-24): nessun amministratore di tenant può farle, e l'amministratore di piattaforma le
// fa dalla console senza un tenant. Il rifiuto per gli attori dei tenant e la scrittura dalla
// console sono provati in lib/i18n/global-catalog-tenant.integration.test.ts.
const GLOBAL_LANGUAGES_WRITE = `${GLOBAL_LANGUAGES}; scrittura riservata all'amministratore di piattaforma (MT5-DEC-17, provata in global-catalog-tenant.integration.test.ts)`
const GLOBAL_TRANSLATIONS_WRITE = `${GLOBAL_TRANSLATIONS}; scrittura riservata all'amministratore di piattaforma (MT5-DEC-17, provata in global-catalog-tenant.integration.test.ts)`
// Le porte della console (pezzo 5a): non ricevono id di tenant e non leggono righe di tenant; un
// amministratore di tenant che non è di piattaforma è rifiutato dalla guardia, provato in
// lib/platform/platform-console.integration.test.ts e lib/platform/platform-admin-actions.integration.test.ts.
// Che nessuna porta della piattaforma esca dai conteggi e dalle email degli amministratori (MT5-OK-2)
// lo prova lib/platform/tenant-service.integration.test.ts.
const PLATFORM_DOOR = 'porta della console: riservata all\'amministratore di piattaforma (la guardia lo rilegge dal database), nessun id di tenant in ingresso; dai tenant escono solo conteggi ed email degli amministratori (MT5-OK-2)'
const ANONYMOUS = 'anonima: nessun id di tenant in ingresso; il tenant, dove serve, viene dall\'indirizzo confrontato con il registro (Task 8)'

const EXEMPT: Record<string, string> = {
  'app/(protected)/(admin)/admin/audit/page.tsx#default': 'non riceve id e non legge righe di tenant: disegna la griglia, che carica le righe da app/api/audit/tenant-grid/route.ts (ha il suo caso qui sotto)',
  'app/(protected)/(admin)/admin/languages/page.tsx#default': `${GLOBAL_LANGUAGES}; sola lettura per i tenant (MT5-DEC-24)`,
  'app/(protected)/(admin)/admin/translations/page.tsx#default': `${GLOBAL_TRANSLATIONS}; sola lettura per i tenant (MT5-DEC-24)`,
  'app/(protected)/[...slug]/page.tsx#default': 'la home per qualunque percorso: non riceve id e non legge righe di tenant (il menu lo disegna il layout)',
  'app/(protected)/page.tsx#default': 'la home: non riceve id e non legge righe di tenant (il menu lo disegna il layout)',
  'app/(protected)/profile/page.tsx#default': PERSONAL,
  'app/(protected)/settings/page.tsx#default': PERSONAL,
  'app/api/auth/[...nextauth]/route.ts#GET': 'gli handler di Auth.js: il tenant del token lo rivalida il callback jwt (Task 4), provato là e negli E2E del Task 11',
  'app/api/auth/[...nextauth]/route.ts#POST': 'gli handler di Auth.js: anche l\'aggiornamento della sessione passa dal callback jwt, che accetta un tenant solo fra quelli disponibili (Task 4, Task 5)',
  'app/api/auth/change-password/route.ts#POST': PERSONAL,
  'app/api/auth/forgot-password/route.ts#POST': ANONYMOUS,
  'app/api/auth/register/route.ts#POST': ANONYMOUS,
  'app/api/auth/set-password/route.ts#POST': 'anonima: riceve solo un token globale monouso, nessun id di tenant',
  'app/api/health/live/route.ts#GET': 'sonda di salute: nessun ingresso e nessuna lettura',
  'app/api/health/ready/route.ts#GET': 'sonda di salute: legge solo la raggiungibilità del database',
  'app/api/i18n/dictionary/route.ts#GET': 'dizionario: catalogo globale, anonimo (MT2-DEC-11)',
  'app/api/i18n/languages-grid/route.ts#POST': GLOBAL_LANGUAGES,
  'app/api/i18n/languages/route.ts#GET': 'elenco pubblico delle lingue: catalogo globale, anonimo (MT2-DEC-11)',
  'app/api/i18n/preferences/language/route.ts#GET': PERSONAL,
  'app/api/i18n/preferences/language/route.ts#PUT': PERSONAL,
  'app/api/i18n/translations-grid/route.ts#POST': GLOBAL_TRANSLATIONS,
  'app/api/platform/audit-grid/route.ts#POST': `${PLATFORM_DOOR}; legge solo il registro della piattaforma e quello del modello, mai quello di un altro tenant (provato in lib/platform/audit-views.integration.test.ts)`,
  'app/api/platform/languages-grid/route.ts#POST': `${PLATFORM_DOOR}; ${GLOBAL_LANGUAGES}`,
  'app/api/platform/tenants-grid/route.ts#POST': PLATFORM_DOOR,
  'app/api/platform/translations-grid/route.ts#POST': `${PLATFORM_DOOR}; ${GLOBAL_TRANSLATIONS}`,
  'app/no-tenant/page.tsx#default': 'il messaggio "non configurato": legge solo lo stato della sessione, nessun id e nessuna riga di tenant',
  'app/platform/admins/page.tsx#default': PLATFORM_DOOR,
  'app/platform/audit/page.tsx#default': PLATFORM_DOOR,
  'app/platform/languages/page.tsx#default': `${PLATFORM_DOOR}; ${GLOBAL_LANGUAGES}`,
  'app/platform/page.tsx#default': PLATFORM_DOOR,
  'app/platform/translations/[keyId]/edit/page.tsx#default': `${PLATFORM_DOOR}; ${GLOBAL_TRANSLATIONS}`,
  'app/platform/translations/create/page.tsx#default': `${PLATFORM_DOOR}; ${GLOBAL_TRANSLATIONS}`,
  'app/platform/translations/page.tsx#default': `${PLATFORM_DOOR}; ${GLOBAL_TRANSLATIONS}`,
  'lib/appearance-actions.ts#saveAppearance': PERSONAL,
  'lib/i18n/language-actions.ts#createLanguage': GLOBAL_LANGUAGES_WRITE,
  'lib/i18n/language-actions.ts#deleteLanguage': GLOBAL_LANGUAGES_WRITE,
  'lib/i18n/language-actions.ts#setDefaultLanguage': GLOBAL_LANGUAGES_WRITE,
  'lib/i18n/language-actions.ts#setLanguageActive': GLOBAL_LANGUAGES_WRITE,
  'lib/i18n/language-actions.ts#updateLanguage': GLOBAL_LANGUAGES_WRITE,
  'lib/i18n/translation-actions.ts#createTranslationKey': GLOBAL_TRANSLATIONS_WRITE,
  'lib/i18n/translation-actions.ts#deleteTranslationKey': GLOBAL_TRANSLATIONS_WRITE,
  'lib/i18n/translation-actions.ts#saveTranslations': GLOBAL_TRANSLATIONS_WRITE,
  'lib/i18n/user-language-actions.ts#getPreferredLanguage': PERSONAL,
  'lib/i18n/user-language-actions.ts#setPreferredLanguage': PERSONAL,
  'lib/platform/platform-admin-actions.ts#addPlatformAdmin': `${PLATFORM_DOOR}; agisce su un account globale, non su una riga di tenant`,
  'lib/platform/platform-admin-actions.ts#removePlatformAdmin': `${PLATFORM_DOOR}; agisce su un account globale, non su una riga di tenant`,
  'lib/profile-actions.ts#saveProfile': PERSONAL,
  'lib/tenancy/tenant-actions.ts#refreshTenant': 'non riceve id: chiede al callback jwt di ricalcolare un token in choose/none, che sceglie solo fra i tenant disponibili (Task 4, Task 5)',
}

// Ogni riga di B porta questo segno nel nome o nell'email: se compare in una risposta, B è uscito.
const MARK_B = `zzzxtb${unique()}`
const B_THEME_COLOR = '#123456'
const A_THEME_COLOR = '#0a5d2c'

let A: TenantId
let B: TenantId
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

// A: un amministratore (la sessione dei casi) e un membro semplice; ruoli di sistema, un ruolo di
// servizio e una voce di menu mutabile per i tentativi di agganciarli a righe di B.
let adminA: string
let memberA: string
let aSystem: { registered: number; tenantAdmin: number }
let aServiceRole: number
let aLeaf: number

// B: un amministratore senza password (un invito per lui creerebbe un token), una persona con la
// password, un ruolo di servizio, una cartella e una pagina incorporata concessa ai ruoli di B.
let bUser: string
let bOther: string
let bOtherEmail: string
let bServiceRole: number
let bCategory: number
let bEmbedded: number
let bRoleIds: number[]
let bEntryIds: number[]
let tenantTables: string[]

async function createUser(label: string, withPassword: boolean): Promise<{ id: string; email: string }> {
  const email = `zzz_xt_${label}_${unique()}@example.test`
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email, idUserStatus: 2, authProvider: 'credentials', passwordHash: withPassword ? 'not-a-real-hash' : null })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function createTenant(name: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-xt-${unique()}`.slice(0, 40)}, ${name})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function addMember(tenantId: TenantId, userId: string, isAdmin: boolean): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId, status: 'active' })
    await tx.insert(userRole).values({ userId, idRole: system.registered })
    if (isAdmin) await tx.insert(userRole).values({ userId, idRole: system.tenantAdmin })
  })
}

/** La sessione come la darebbe Auth.js dopo il callback jwt: tenant scelto A, ruoli letti da A. */
function sessionOf(userId: string, tenantState: 'ready' | 'choose' = 'ready') {
  const ready = tenantState === 'ready'
  return {
    user: {
      id: userId,
      email: `${userId}@example.test`,
      name: 'ZZZ Amministratore di A',
      roleIds: ready ? [aSystem.registered, aSystem.tenantAdmin] : [],
      accountActive: true,
      provider: 'credentials',
      tenantState,
      tenantId: ready ? Number(A) : null,
      tenantName: ready ? 'ZZZ Alfa' : null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

/**
 * L'impronta di B: per ogni tabella di tenant del registro l'md5 delle righe di B (la RLS forzata
 * vale anche per il proprietario), più le righe globali che appartengono a B: la riga di `tenant`,
 * i suoi indirizzi, le sue persone e i loro token. Un'istruzione sola, costruita una volta.
 */
async function fingerprintOfB(): Promise<Record<string, string | null>> {
  const people = `{${[bUser, bOther].join(',')}}`
  const perTable = tenantTables.map(name => sql`(select md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
    from ${sql.identifier('public')}.${sql.identifier(name)} t) as ${sql.identifier(name)}`)
  const [row] = await withOwner(tx => tx.execute<Record<string, string | null>>(sql`
    select ${sql.join(perTable, sql`, `)},
      (select md5(string_agg(t::text, '|' order by t::text)) from public.tenant t where t.id = ${B}) as tenant_row,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.tenant_host t
        where t.id_tenant = ${B}) as tenant_host,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.users t
        where t.id = any(${people}::uuid[])) as people,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.password_set_tokens t
        where t.user_id = any(${people}::uuid[])) as tokens
  `), B)
  return row
}

/** Una serializzazione che attraversa anche gli elementi React (le props), senza cicli. */
function serialized(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) return undefined
      seen.add(current)
    }
    return typeof current === 'bigint' ? current.toString() : current
  }) ?? ''
}

function expectNoTraceOfB(value: unknown): void {
  expect(serialized(value)).not.toContain(MARK_B)
}

/** Le props di un elemento React restituito da una pagina. */
function propsOf<T>(element: unknown): T {
  return (element as { props: T }).props
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function navInput(overrides: Partial<CreateNavItemInput>): CreateNavItemInput {
  return {
    name: `ZZZ voce di A ${unique()}`,
    idItemType: 2,
    idFunctionalityType: FUNCTYPE_EXTERNAL_LINK,
    functionalityLink: 'https://example.test/a',
    iconPath: null,
    idItemParent: null,
    description: '',
    itemTranslation: {},
    tagTranslations: {},
    ...overrides,
  }
}

async function roleFunctionalitiesOf(tenantId: TenantId, roleId: number): Promise<number[]> {
  const rows = await withOwner(tx => tx.select({ id: roleFunctionality.idMenuEntry }).from(roleFunctionality)
    .where(eq(roleFunctionality.idRole, roleId)), tenantId)
  return rows.map(row => row.id)
}

async function userRolesOf(tenantId: TenantId, userId: string): Promise<number[]> {
  const rows = await withOwner(tx => tx.select({ id: userRole.idRole }).from(userRole)
    .where(eq(userRole.userId, userId)).orderBy(userRole.idRole), tenantId)
  return rows.map(row => row.id)
}

async function setSelfRegistrationOf(tenantId: TenantId, enabled: boolean): Promise<void> {
  await withOwner(tx => tx.update(tenantSettings).set({ selfRegistration: enabled }), tenantId)
}

/** Il permesso di assistenza di un tenant, scritto dal fixture: valido per un'ora o tolto. */
async function setConsentOf(tenantId: TenantId, valid: boolean): Promise<void> {
  await withOwner(tx => tx.update(tenantSettings).set({ supportUntil: valid ? sql`now() + interval '1 hour'` : null }), tenantId)
}

async function consentOf(tenantId: TenantId): Promise<string | null> {
  const [row] = await withOwner(tx => tx.select({ until: tenantSettings.supportUntil }).from(tenantSettings), tenantId)
  return row?.until ?? null
}

async function lastTenantOf(userId: string): Promise<number | null> {
  const [row] = await withGlobal(tx => tx.select({ last: users.lastTenantId }).from(users).where(eq(users.id, userId)))
  return row?.last ?? null
}

function collectIds(tree: Array<{ id: number; children?: unknown[] }>): number[] {
  return tree.flatMap(node => [node.id, ...collectIds((node.children ?? []) as Array<{ id: number; children?: unknown[] }>)])
}

const CASES: Record<string, CrossTenantCase> = {
  // --- Azioni del server -------------------------------------------------------------------------
  'lib/rbac/users-actions.ts#updateUserRoles': {
    entry: updateUserRoles,
    run: async () => {
      // Una persona di B: per A non è un membro.
      await expect(updateUserRoles(bUser, [aSystem.registered])).rejects.toThrow('La persona non fa parte di questo tenant')
      // Un membro di A con un ruolo di B: la chiave esterna (tenant, ruolo) rifiuta, e i suoi ruoli restano quelli.
      const before = await userRolesOf(A, memberA)
      await expect(updateUserRoles(memberA, [bServiceRole])).rejects.toThrow()
      expect(await userRolesOf(A, memberA)).toEqual(before)
    },
  },
  'lib/rbac/users-actions.ts#setUserStatus': {
    entry: setUserStatus,
    run: async () => {
      await expect(setUserStatus(bUser, USER_STATUS_DEACTIVATED)).rejects.toThrow('La persona non fa parte di questo tenant')
    },
  },
  'lib/rbac/users-actions.ts#addUserByEmail': {
    entry: addUserByEmail,
    run: async () => {
      // Aggiungere per email una persona che esiste altrove è previsto (MT2-DEC-5): la risposta è la
      // stessa di un'email sconosciuta, non dice niente di B, e di B non cambia niente (l'impronta).
      // Il segno di B è nell'email, che il chiamante conosce già: la risposta non deve aggiungere altro.
      try {
        const result = await addUserByEmail(bOtherEmail)
        expect(result).toEqual({ ok: true })
      } finally {
        // L'appartenenza nuova è di A: si toglie, perché gli elenchi di A dei casi dopo non la vedano.
        await withOwner(async tx => {
          await tx.delete(userRole).where(eq(userRole.userId, bOther))
          await tx.delete(tenantMembership).where(eq(tenantMembership.userId, bOther))
        }, A)
      }
    },
  },
  'lib/rbac/roles-actions.ts#createRole': {
    entry: createRole,
    run: async () => {
      const { id } = await createRole(`ZZZ ruolo nuovo di A ${unique()}`)
      expect(bRoleIds).not.toContain(id)
      const [created] = await withOwner(tx => tx.select({ id: role.idRole }).from(role).where(eq(role.idRole, id)), A)
      expect(created).toEqual({ id })
    },
  },
  'lib/rbac/roles-actions.ts#renameRole': {
    entry: renameRole,
    run: async () => {
      await expect(renameRole(bServiceRole, 'ZZZ preso da A')).rejects.toThrow('Role not found')
    },
  },
  'lib/rbac/roles-actions.ts#updateRolePermissions': {
    entry: updateRolePermissions,
    run: async () => {
      const grantB = { operations: [], functionalities: [{ idItem: bEmbedded, authorization: true }] }
      // Un ruolo di B: per A non esiste.
      await expect(updateRolePermissions(bServiceRole, grantB)).rejects.toThrow('Role not found')
      // Un ruolo di A con una voce di B: la chiave esterna (tenant, voce) rifiuta, niente si scrive.
      await expect(updateRolePermissions(aServiceRole, grantB)).rejects.toThrow()
      expect(await roleFunctionalitiesOf(A, aServiceRole)).toEqual([])
    },
  },
  'lib/rbac/roles-actions.ts#deleteRole': {
    entry: deleteRole,
    run: async () => {
      await expect(deleteRole(bServiceRole)).rejects.toThrow('Role not found')
    },
  },
  'lib/rbac/navigation-actions.ts#createNavigationItem': {
    entry: createNavigationItem,
    run: async () => {
      // Una voce di A dentro una cartella di B: la chiave esterna (tenant, genitore) rifiuta.
      const name = `ZZZ voce orfana ${unique()}`
      await expect(createNavigationItem(navInput({ name, idItemParent: bCategory }))).rejects.toThrow('Failed to create item')
      const leftovers = await withOwner(tx => tx.select({ id: menuEntry.idMenuEntry }).from(menuEntry).where(eq(menuEntry.name, name)), A)
      expect(leftovers).toEqual([])
    },
  },
  'lib/rbac/navigation-actions.ts#updateNavigationItem': {
    entry: updateNavigationItem,
    run: async () => {
      await expect(updateNavigationItem(bEmbedded, navInput({ name: 'ZZZ presa da A' }))).rejects.toThrow('Item not found')
      // Una voce di A spostata dal modulo sotto una cartella di B: per A quella cartella non esiste.
      await expect(updateNavigationItem(aLeaf, navInput({ idItemParent: bCategory }))).rejects.toThrow('Target parent must be a category')
    },
  },
  'lib/rbac/navigation-actions.ts#moveNavigationItem': {
    entry: moveNavigationItem,
    run: async () => {
      await expect(moveNavigationItem(bEmbedded, { targetParentId: null, orderPosition: 0 })).rejects.toThrow('Item not found')
      await expect(moveNavigationItem(aLeaf, { targetParentId: bCategory, orderPosition: 0 })).rejects.toThrow('Target parent must be a category')
    },
  },
  'lib/rbac/navigation-actions.ts#deleteNavigationItem': {
    entry: deleteNavigationItem,
    run: async () => {
      // Una voce che per A non esiste: nessun effetto, come per un id mai esistito.
      await expect(deleteNavigationItem(bEmbedded)).resolves.toBeUndefined()
      await expect(deleteNavigationItem(bCategory)).resolves.toBeUndefined()
    },
  },
  'lib/tenancy/tenant-actions.ts#chooseTenant': {
    entry: chooseTenant,
    run: async () => {
      const before = await lastTenantOf(adminA)
      await expect(chooseTenant(Number(B))).rejects.toThrow('tenant_not_available')
      expect(await lastTenantOf(adminA)).toBe(before)
      expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    },
  },
  'lib/tenancy/tenant-settings-actions.ts#setSelfRegistration': {
    entry: setSelfRegistration,
    arrange: async () => {
      await setSelfRegistrationOf(A, false)
      await setSelfRegistrationOf(B, false)
    },
    run: async () => {
      // Non riceve il tenant: scrive quello dell'attore. B resta spento (l'impronta), A si accende.
      await setSelfRegistration(true)
      const [row] = await withOwner(tx => tx.select({ on: tenantSettings.selfRegistration }).from(tenantSettings), A)
      expect(row).toEqual({ on: true })
    },
  },
  // --- Il permesso di assistenza (pezzo 5a, Task 9) -----------------------------------------------
  // Come setSelfRegistration: nessun parametro dice il tenant, si scrive quello dell'attore.
  'lib/tenancy/support-consent-actions.ts#grantSupportConsent': {
    entry: grantSupportConsent,
    arrange: async () => {
      await setConsentOf(A, false)
      await setConsentOf(B, false)
    },
    run: async () => {
      await grantSupportConsent('1h')
      expect(await consentOf(A)).not.toBeNull()
    },
  },
  'lib/tenancy/support-consent-actions.ts#revokeSupportConsent': {
    entry: revokeSupportConsent,
    arrange: async () => {
      await setConsentOf(A, true)
      await setConsentOf(B, true)
    },
    run: async () => {
      // A perde il permesso, B (l'impronta) lo tiene.
      expect(await revokeSupportConsent()).toEqual({ ok: true })
      expect(await consentOf(A)).toBeNull()
    },
  },
  'lib/theme-actions.ts#saveAppTheme': {
    entry: saveAppTheme,
    run: async () => {
      // L'aggiornamento non ha un filtro sul tenant: lo limita la RLS. Cambia A, B resta com'era.
      const result = await saveAppTheme(
        { primaryColor: A_THEME_COLOR, primaryDark: null, surfaces: { light: {}, dark: {} } },
        { acknowledgeWarnings: true },
      )
      expect(result).toEqual({ saved: true, error: null })
      const [row] = await withOwner(tx => tx.select({ color: appTheme.primaryColor }).from(appTheme), A)
      expect(row).toEqual({ color: A_THEME_COLOR })
    },
  },

  // --- Le porte della console che nominano un tenant (pezzo 5a, Task 8) ---------------------------
  // La sessione dei casi è l'amministratore di A: un amministratore di tenant, non di piattaforma. La
  // guardia rilegge l'attributo dal database e rifiuta, e B (tenant, indirizzi, persone, token) resta com'era.
  'lib/platform/tenant-actions.ts#createTenant': {
    entry: createPlatformTenant,
    run: async () => {
      await expect(createPlatformTenant({ name: 'ZZZ preso da A', slug: `zzz-xt-new-${unique()}`.slice(0, 40), adminEmail: bOtherEmail }))
        .rejects.toThrow('Unauthorized')
    },
  },
  'lib/platform/tenant-actions.ts#setTenantStatus': {
    entry: setTenantStatus,
    run: async () => {
      await expect(setTenantStatus(Number(B), 'suspended')).rejects.toThrow('Unauthorized')
      await expect(setTenantStatus(Number(B), 'archived', 'preso da A')).rejects.toThrow('Unauthorized')
    },
  },
  'lib/platform/tenant-actions.ts#addTenantHost': {
    entry: addTenantHost,
    run: async () => { await expect(addTenantHost(Number(B), `zzz-xt-${unique()}.example.test`, true)).rejects.toThrow('Unauthorized') },
  },
  'lib/platform/tenant-actions.ts#setPrimaryHost': {
    entry: setPrimaryHost,
    run: async () => { await expect(setPrimaryHost(Number(B), 'b.example.test')).rejects.toThrow('Unauthorized') },
  },
  'lib/platform/tenant-actions.ts#removeTenantHost': {
    entry: removeTenantHost,
    run: async () => { await expect(removeTenantHost(Number(B), 'b.example.test')).rejects.toThrow('Unauthorized') },
  },
  'lib/platform/tenant-actions.ts#addTenantAdmin': {
    entry: addTenantAdmin,
    run: async () => { await expect(addTenantAdmin(Number(B), bOtherEmail)).rejects.toThrow('Unauthorized') },
  },
  'lib/platform/tenant-actions.ts#resendTenantInvite': {
    entry: resendTenantInvite,
    run: async () => {
      // bUser è l'amministratore di B senza password: un invito per lui creerebbe un token (l'impronta lo vedrebbe).
      await expect(resendTenantInvite(Number(B), bUser)).rejects.toThrow('Unauthorized')
    },
  },
  // L'ingresso di assistenza (Task 9): l'amministratore di A non è amministratore di piattaforma, e
  // nemmeno con il permesso valido di B entra in B o scrive nei suoi registri.
  'lib/platform/support-actions.ts#startSupport': {
    entry: startSupport,
    arrange: () => setConsentOf(B, true),
    run: async () => {
      await expect(startSupport(Number(B), 'preso da A')).rejects.toThrow('Unauthorized')
      expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    },
  },
  'lib/platform/support-actions.ts#endSupport': {
    entry: endSupport,
    run: async () => {
      // Una sessione che si dice in assistenza in B: la guardia rilegge l'attributo e rifiuta, nessuna uscita nei registri di B.
      mocks.session = { ...sessionOf(adminA), user: { ...sessionOf(adminA).user, tenantState: 'support', tenantId: Number(B) } }
      await expect(endSupport()).rejects.toThrow('Unauthorized')
      expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    },
  },
  'app/platform/tenants/[tenantId]/page.tsx#default': {
    entry: PlatformTenantPage,
    run: async () => {
      await expect(PlatformTenantPage({ params: Promise.resolve({ tenantId: String(B) }) })).rejects.toThrow('NEXT_NOT_FOUND')
    },
  },

  // --- Rotte di app/api --------------------------------------------------------------------------
  'app/api/admin/send-invite/route.ts#POST': {
    entry: sendInvite,
    run: async () => {
      // Una persona di B risponde come un id che non esiste, e nessun token d'invito nasce (l'impronta).
      const response = await sendInvite(jsonRequest('/api/admin/send-invite', { userId: bUser }))
      expect(response.status).toBe(404)
      expectNoTraceOfB(await response.json())
    },
  },
  'app/api/rbac/users-grid/route.ts#POST': {
    entry: usersGrid,
    run: async () => {
      const all = await usersGrid(jsonRequest('/api/rbac/users-grid', { page: 0, size: 100 }))
      expect(all.status).toBe(200)
      const allBody = await all.json() as { users: Array<{ id: string }>; total: number }
      expect(allBody.users.map(user => user.id).sort()).toEqual([adminA, memberA].sort())
      expectNoTraceOfB(allBody)

      const byEmail = await usersGrid(jsonRequest('/api/rbac/users-grid', { page: 0, size: 100, emailSearch: MARK_B }))
      expect(await byEmail.json()).toEqual({ users: [], total: 0 })

      const byRole = await usersGrid(jsonRequest('/api/rbac/users-grid', { page: 0, size: 100, roleIds: bRoleIds }))
      expect(await byRole.json()).toEqual({ users: [], total: 0 })
    },
  },
  'app/api/audit/tenant-grid/route.ts#POST': {
    entry: tenantAuditGrid,
    run: async () => {
      // A ha la sua voce, B la sua (con il segno): per A c'è la prima (e le voci che gli altri casi
      // hanno scritto per A), mai quella di B, nemmeno cercando il segno.
      const all = await tenantAuditGrid(jsonRequest('/api/audit/tenant-grid', { page: 0, size: 200, sort: 'occurredAt', direction: 'ASC' }))
      expect(all.status).toBe(200)
      const allBody = await all.json() as { rows: Array<{ operation: string; objectId: string | null }>; total: number }
      const objectIds = allBody.rows.map(row => row.objectId)
      expect(objectIds).toContain('a-audit')
      expect(objectIds).not.toContain('b-audit')
      expectNoTraceOfB(allBody)

      const byActor = await tenantAuditGrid(jsonRequest('/api/audit/tenant-grid', { page: 0, size: 100, actorSearch: MARK_B }))
      expect(await byActor.json()).toEqual({ rows: [], total: 0 })
    },
  },
  'app/api/rbac/roles-grid/route.ts#POST': {
    entry: rolesGrid,
    run: async () => {
      const all = await rolesGrid(jsonRequest('/api/rbac/roles-grid', { page: 0, size: 100 }))
      expect(all.status).toBe(200)
      const allBody = await all.json() as { elements: Array<{ id: number }>; total: number }
      expect(allBody.elements.length).toBeGreaterThan(0)
      expect(allBody.elements.map(element => element.id).filter(id => bRoleIds.includes(id))).toEqual([])
      expectNoTraceOfB(allBody)

      const bySearch = await rolesGrid(jsonRequest('/api/rbac/roles-grid', { page: 0, size: 100, search: MARK_B }))
      const searchBody = await bySearch.json() as { elements: unknown[]; total: number }
      expect(searchBody.elements).toEqual([])
      expect(searchBody.total).toBe(0)
    },
  },

  // --- Pagine ------------------------------------------------------------------------------------
  'app/(protected)/(admin)/functionalities/[funcId]/edit/page.tsx#default': {
    entry: EditFunctionalityPage,
    run: async () => {
      // Per A la voce di B non esiste: 404, come per un id mai esistito, senza dati di B.
      await expect(EditFunctionalityPage({ params: Promise.resolve({ funcId: String(bEmbedded) }) }))
        .rejects.toThrow('NEXT_NOT_FOUND')
    },
  },
  'app/(protected)/(admin)/functionalities/create/page.tsx#default': {
    entry: CreateFunctionalityPage,
    run: async () => {
      // `?parent=` con una cartella di B: fra i genitori proposti ci sono solo voci di A.
      const element = await CreateFunctionalityPage({ searchParams: Promise.resolve({ parent: String(bCategory) }) })
      const { parents } = propsOf<{ parents: Array<{ id: number }> }>(element)
      expect(parents.length).toBeGreaterThan(0)
      expect(parents.map(parent => parent.id).filter(id => bEntryIds.includes(id))).toEqual([])
      expectNoTraceOfB(parents)
    },
  },
  'app/(protected)/(admin)/functionalities/page.tsx#default': {
    entry: FunctionalitiesPage,
    run: async () => {
      const element = await FunctionalitiesPage()
      const { tree } = propsOf<{ tree: Array<{ id: number; children?: unknown[] }> }>(element)
      const ids = collectIds(tree)
      expect(ids).toContain(aLeaf)
      expect(ids.filter(id => bEntryIds.includes(id))).toEqual([])
      expectNoTraceOfB(tree)
    },
  },
  'app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx#default': {
    entry: RoleDetailPage,
    run: async () => {
      // Per A il ruolo di B non esiste: 404, come per un id mai esistito, senza dati di B.
      await expect(RoleDetailPage({ params: Promise.resolve({ roleId: String(bServiceRole) }) }))
        .rejects.toThrow('NEXT_NOT_FOUND')
    },
  },
  'app/(protected)/(admin)/roles-permissions/page.tsx#default': {
    entry: RolesPage,
    run: async () => {
      // La pagina disegna la griglia, che carica i dati da rbac/roles-grid: con un filtro sugli id di
      // un ruolo di B ripete il filtro (lo conosce già il chiamante) e non legge niente di B.
      const range = String(bServiceRole)
      expectNoTraceOfB(propsOf(await RolesPage({ searchParams: Promise.resolve({ idMin: range, idMax: range }) })))
    },
  },
  'app/(protected)/(admin)/user-management/page.tsx#default': {
    entry: UserManagementPage,
    run: async () => {
      const element = await UserManagementPage({ searchParams: Promise.resolve({}) })
      // L'elemento è il contenitore della pagina: la griglia è il suo figlio.
      const grid = propsOf<{ children: unknown }>(element).children
      const props = propsOf<{ allRoles: Array<{ id: number }>; assignableRoleIds: number[]; registeredRoleId: number }>(grid)
      expect(props.allRoles.map(r => r.id).filter(id => bRoleIds.includes(id))).toEqual([])
      expect(props.assignableRoleIds.filter(id => bRoleIds.includes(id))).toEqual([])
      expect(props.registeredRoleId).toBe(aSystem.registered)
      expectNoTraceOfB(props)
    },
  },
  'app/(protected)/(admin)/admin/tenant-settings/page.tsx#default': {
    entry: TenantSettingsPage,
    arrange: async () => {
      await setSelfRegistrationOf(A, false)
      await setSelfRegistrationOf(B, true)
      await setConsentOf(A, false)
      await setConsentOf(B, true)
    },
    run: async () => {
      // L'interruttore di A (spento, quello di B è acceso); A non ha un indirizzo dedicato. Il
      // permesso di assistenza è quello di A (nessuno), non quello di B (valido).
      expect(propsOf<{ initialEnabled: boolean; selfRegistrationApplies: boolean }>(await TenantSettingsPage()))
        .toEqual({ initialEnabled: false, selfRegistrationApplies: false, support: { until: null, inProgress: false, locked: false } })
    },
  },
  'app/(protected)/(admin)/admin/theme/page.tsx#default': {
    entry: ThemePage,
    run: async () => {
      const { savedTheme } = propsOf<{ savedTheme: { primaryColor: string } }>(await ThemePage())
      const [row] = await withOwner(tx => tx.select({ color: appTheme.primaryColor }).from(appTheme), A)
      expect(savedTheme.primaryColor).toBe(row.color)
      expect(savedTheme.primaryColor).not.toBe(B_THEME_COLOR)
    },
  },
  'app/(protected)/embedded/[itemId]/page.tsx#default': {
    entry: EmbeddedItemPage,
    run: async () => {
      await expect(EmbeddedItemPage({ params: Promise.resolve({ itemId: String(bEmbedded) }) })).rejects.toThrow('NEXT_NOT_FOUND')
    },
  },
  'app/select-tenant/page.tsx#default': {
    entry: SelectTenantPage,
    run: async () => {
      // Con il tenant già scelto si torna alla home.
      await expect(SelectTenantPage()).rejects.toThrow('NEXT_REDIRECT:/')
      // Da scegliere: fra i tenant proposti c'è A e non B, dove la persona non è membro.
      mocks.session = sessionOf(adminA, 'choose')
      const element = await SelectTenantPage()
      const chooser = propsOf<{ children: unknown }>(element).children
      const { tenants } = propsOf<{ tenants: Array<{ tenantId: number }> }>(chooser)
      expect(tenants.map(tenant => Number(tenant.tenantId))).toContain(Number(A))
      expect(tenants.map(tenant => Number(tenant.tenantId))).not.toContain(Number(B))
      expectNoTraceOfB(tenants)
    },
  },
}

const entryKey = (entry: { file: string; name: string }) => `${entry.file}#${entry.name}`

describe('cross-tenant entry-point inventory', () => {
  it('every entry point has a cross-tenant case or a motivated exemption', () => {
    const missing = listEntryPoints().map(entryKey).filter(key => !(key in CASES) && !(key in EXEMPT))
    expect(missing).toEqual([])
  })

  it('no entry point is both a case and an exemption, and every exemption says why', () => {
    expect(Object.keys(CASES).filter(key => key in EXEMPT)).toEqual([])
    for (const [key, reason] of Object.entries(EXEMPT)) expect(reason.trim().length, key).toBeGreaterThan(20)
  })

  it('every case and exemption names an entry point that still exists', () => {
    const known = new Set(listEntryPoints().map(entryKey))
    expect([...Object.keys(CASES), ...Object.keys(EXEMPT)].filter(key => !known.has(key))).toEqual([])
  })

  it('every case exercises the export its key names', async () => {
    // Il caso chiama `entry`: dev'essere proprio l'export che l'inventario conosce con quel nome.
    const mismatched: string[] = []
    for (const [key, { entry }] of Object.entries(CASES)) {
      const [file, name] = key.split('#')
      const exported = await import(resolve(process.cwd(), file)) as Record<string, unknown>
      if (exported[name] !== entry) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })
})

describeIntegration('every entry point refuses another tenant\'s data', () => {
  beforeAll(async () => {
    const [template] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
    if (!template) throw new Error('template tenant missing: is migration 0050 applied?')
    const registry = await withGlobal(tx => tx.execute<{ name: string }>(
      sql`select table_name as name from app_private.table_class where class = 'tenant' order by table_name`))
    tenantTables = registry.map(row => row.name)

    A = await createTenant('ZZZ Alfa')
    B = await createTenant(`ZZZ Beta ${MARK_B}`)

    adminA = (await createUser('a_admin', true)).id
    memberA = (await createUser('a_member', true)).id
    const bAdmin = await createUser(`b_admin_${MARK_B}`, false)
    bUser = bAdmin.id
    const other = await createUser(`b_other_${MARK_B}`, true)
    bOther = other.id
    bOtherEmail = other.email
    await addMember(A, adminA, true)
    await addMember(A, memberA, false)
    await addMember(B, bUser, true)
    await addMember(B, bOther, false)

    aSystem = await withTenant(A, tx => getSystemRoleIds(tx))
    await withTenant(A, async tx => {
      const [service] = await tx.insert(role).values({ description: 'ZZZ ruolo di servizio di A', idRoleType: 2 })
        .returning({ id: role.idRole })
      aServiceRole = service.id
      const [leaf] = await tx.insert(menuEntry).values({
        name: 'ZZZ voce di A', idFunctionalityType: FUNCTYPE_EXTERNAL_LINK, functionalityLink: 'https://example.test/a',
      }).returning({ id: menuEntry.idMenuEntry })
      aLeaf = leaf.id
    })

    await withTenant(B, async tx => {
      const system = await getSystemRoleIds(tx)
      const [service] = await tx.insert(role).values({ description: `ZZZ ruolo ${MARK_B}`, idRoleType: 2 })
        .returning({ id: role.idRole })
      bServiceRole = service.id
      const [category] = await tx.insert(menuEntry).values({ name: `ZZZ cartella ${MARK_B}` })
        .returning({ id: menuEntry.idMenuEntry })
      bCategory = category.id
      const [embedded] = await tx.insert(menuEntry).values({
        name: `ZZZ pagina ${MARK_B}`, idParent: bCategory, idFunctionalityType: FUNCTYPE_EMBEDDED_PAGE,
        functionalityLink: 'https://example.test/b',
      }).returning({ id: menuEntry.idMenuEntry })
      bEmbedded = embedded.id
      await tx.insert(roleFunctionality).values([
        { idRole: system.registered, idMenuEntry: bEmbedded },
        { idRole: bServiceRole, idMenuEntry: bEmbedded },
      ])
      await tx.update(appTheme).set({ primaryColor: B_THEME_COLOR })
    })

    // Una voce di registro per tenant: quella di B porta il segno nell'email di chi ha agito.
    await withOwner(tx => tx.insert(tenantAuditEvent).values({
      actorKind: 'person', actorEmail: `zzz_a_${unique()}@example.test`, operation: 'role.create', objectType: 'role', objectId: 'a-audit',
    }), A)
    await withOwner(tx => tx.insert(tenantAuditEvent).values({
      actorKind: 'person', actorEmail: `zzz_${MARK_B}@example.test`, operation: 'role.create', objectType: 'role', objectId: 'b-audit',
      details: { name: MARK_B },
    }), B)

    const bRoles = await withOwner(tx => tx.select({ id: role.idRole }).from(role), B)
    bRoleIds = bRoles.map(row => row.id)
    const bEntries = await withOwner(tx => tx.select({ id: menuEntry.idMenuEntry }).from(menuEntry), B)
    bEntryIds = bEntries.map(row => row.id)
  }, 90_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  beforeEach(() => {
    mocks.session = sessionOf(adminA)
    mocks.headers = new Headers({ host: 'localhost:3000' })
    mocks.unstableUpdate.mockReset().mockResolvedValue(null)
  })

  it('the fixture is what the cases assume: A and B apart, B with its own rows', async () => {
    expect(bRoleIds).toContain(bServiceRole)
    expect(bEntryIds).toEqual(expect.arrayContaining([bCategory, bEmbedded]))
    // Nessuna persona di A è membro di B.
    const crossMembers = await withOwner(tx => tx.select({ userId: tenantMembership.userId }).from(tenantMembership)
      .where(inArray(tenantMembership.userId, [adminA, memberA])), B)
    expect(crossMembers).toEqual([])
    const [bTheme] = await withOwner(tx => tx.select({ color: appTheme.primaryColor }).from(appTheme), B)
    expect(bTheme).toEqual({ color: B_THEME_COLOR })
  }, 30_000)

  it('a session that names tenant B for a person who is not a member of B gets no authority', async () => {
    // Il token lo rivalida il callback jwt (Task 4); qui si prova la seconda difesa, l'attore letto da B.
    const before = await fingerprintOfB()
    mocks.session = { ...sessionOf(adminA), user: { ...sessionOf(adminA).user, tenantId: Number(B) } }
    const response = await usersGrid(jsonRequest('/api/rbac/users-grid', { page: 0, size: 100 }))
    expect(response.status).toBe(403)
    await expect(renameRole(bServiceRole, 'ZZZ preso da A')).rejects.toThrow('Unauthorized')
    expect(await fingerprintOfB()).toEqual(before)
  }, 30_000)

  for (const [key, testCase] of Object.entries(CASES)) {
    it(key, async () => {
      await testCase.arrange?.()
      const before = await fingerprintOfB()
      await testCase.run()
      expect(await fingerprintOfB()).toEqual(before)
    }, 30_000)
  }
})
