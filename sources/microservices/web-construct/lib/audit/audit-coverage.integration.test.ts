import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { listEntryPoints } from '@/guards/entry-point-inventory'
import { AUDIT_OPERATIONS, type AuditOperation } from '@/lib/audit/audit-types'
import {
  allowedDomains, appLanguage, menuEntry, permission, platformAuditEvent, role, tenantAuditEvent,
  tenantMembership, tenantSettings, userRole, users,
} from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import {
  cleanupTestData, describeIntegration, TEST_ACTOR_ID, testKey, unique,
} from '@/lib/i18n/test-support/db-fixtures'
import { createLanguage, deleteLanguage, setDefaultLanguage, setLanguageActive, updateLanguage } from '@/lib/i18n/language-actions'
import { createTranslationKey, deleteTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { createNavigationItem, deleteNavigationItem, moveNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import { addPlatformAdmin, removePlatformAdmin } from '@/lib/platform/platform-admin-actions'
import {
  addTenantAdmin, addTenantHost, createTenant as createPlatformTenant, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus,
} from '@/lib/platform/tenant-actions'
import { createRole, deleteRole, renameRole, updateRolePermissions } from '@/lib/rbac/roles-actions'
import { FUNCTYPE_EXTERNAL_LINK, USER_STATUS_DEACTIVATED, type CreateNavItemInput } from '@/lib/rbac/types'
import { addUserByEmail, setUserStatus, updateUserRoles } from '@/lib/rbac/users-actions'
import { saveAppTheme } from '@/lib/theme-actions'
import { POST as sendInvite } from '@/app/api/admin/send-invite/route'
import { POST as register } from '@/app/api/auth/register/route'
import { enterTenant } from '@/lib/tenancy/token-tenant'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { setSelfRegistration } from '@/lib/tenancy/tenant-settings-actions'
import { grantSupportConsent, revokeSupportConsent } from '@/lib/tenancy/support-consent-actions'
import { endSupport, startSupport } from '@/lib/platform/support-actions'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/**
 * Nessuna modifica senza voce nel registro (specifica 2026-10-26, §2.4, MT5-DEC-14, MT5-DEC-15,
 * MT5-OK-1, MT5-RISK-3, MT5-RISK-4). L'inventario delle porte (`guards/entry-point-inventory.ts`)
 * dice quali sono: per ognuna che può modificare dati c'è qui un caso (rifiutata non scrive niente,
 * riuscita scrive le voci attese, nel registro giusto) oppure un'esenzione con il motivo. Una porta
 * nuova senza né l'uno né l'altra fa fallire il primo test: chi la aggiunge decide se registra.
 *
 * Un caso chiama la porta vera, nello stesso processo, con la sessione di una persona vera di un
 * tenant creato dal modello e le guardie vere. Finti sono solo i confini di Next e di Auth.js, il
 * limite di richieste e l'invio dell'email. Le voci si leggono come proprietario: l'app, per
 * costruzione, non può rileggere il registro della piattaforma.
 *
 * Le pagine e i gestori GET/HEAD non scrivono dati: non servono né casi né esenzioni.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
}))
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
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/lib/invitation-email', () => ({
  sendInvitationEmail: async () => ({ ok: true }),
  sendMainAddressInvitationEmail: async () => ({ ok: true }),
}))
vi.mock('@/lib/auth-rate-limit', () => ({
  enforceAuthRateLimit: async () => undefined,
  AuthRateLimitExceeded: class AuthRateLimitExceeded extends Error {},
}))

// ---------------------------------------------------------------------------------------------
// Le porte che non scrivono nel registro, ciascuna con il motivo.
// ---------------------------------------------------------------------------------------------
const PERSONAL = 'preferenza personale (MT5-DEC-14): agisce solo sulla riga globale della persona della sessione, e le preferenze non si registrano'
const PASSWORD = 'password della persona (MT5-DEC-14): non si registra, e nel registro non deve mai finire un segreto (MT5-RISK-4)'
const READ = 'lettura: restituisce dati e non ne modifica (le griglie sono POST per portare il filtro nel corpo)'

const EXEMPT: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts#POST': 'l\'evento di accesso (MT5-DEC-14): gli accessi non si registrano. Le righe di tenant che il primo accesso crea (appartenenza e ruolo base nel tenant predefinito, dal callback jwt) invece si registrano: vedi il caso «first sign-in» più sotto',
  'app/api/auth/change-password/route.ts#POST': PASSWORD,
  'app/api/auth/forgot-password/route.ts#POST': `${PASSWORD}; scrive solo il token di recupero`,
  'app/api/auth/set-password/route.ts#POST': `${PASSWORD}; consuma il token d'invito o di recupero`,
  'app/api/audit/tenant-grid/route.ts#POST': READ,
  'app/api/i18n/languages-grid/route.ts#POST': READ,
  'app/api/i18n/preferences/language/route.ts#PUT': PERSONAL,
  'app/api/i18n/translations-grid/route.ts#POST': READ,
  'app/api/platform/audit-grid/route.ts#POST': READ,
  'app/api/platform/languages-grid/route.ts#POST': READ,
  'app/api/platform/tenants-grid/route.ts#POST': READ,
  'app/api/platform/translations-grid/route.ts#POST': READ,
  'app/api/rbac/roles-grid/route.ts#POST': READ,
  'app/api/rbac/users-grid/route.ts#POST': READ,
  'lib/appearance-actions.ts#saveAppearance': PERSONAL,
  'lib/i18n/user-language-actions.ts#getPreferredLanguage': READ,
  'lib/i18n/user-language-actions.ts#setPreferredLanguage': PERSONAL,
  'lib/profile-actions.ts#saveProfile': PERSONAL,
  'lib/tenancy/tenant-actions.ts#chooseTenant': `${PERSONAL}: scrive l'ultimo tenant scelto (users.last_tenant_id), e l'ingresso in un tenant è un accesso`,
  'lib/tenancy/tenant-actions.ts#refreshTenant': 'non scrive dati: chiede al callback jwt di ricalcolare il token',
}

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------
const DEFAULT = defaultTestTenant()
let A: TenantId
const createdTenants: TenantId[] = []
const createdEmails: string[] = []

type Person = { id: string; email: string }
let adminA: Person
let memberA: Person
let person: Person
let catalogAdmin: Person
let platformAdmin: Person
let allowedDomain: string
let hostA: string
let readMenuPermission: number
let originalDefaultLanguage: number

/** Lo stato che un caso lascia al successivo (un ruolo creato, poi rinominato, poi cancellato). */
const state = {
  roleId: 0,
  navId: 0,
  categoryId: 0,
  newMemberEmail: '',
  registeredEmail: '',
  languageId: 0,
  languageCode: '',
  keyId: 0,
  platformAdminEmail: '',
  consoleTenantId: 0,
  consoleHostA: '',
  consoleHostB: '',
  consoleAdminEmail: '',
}

async function createUser(label: string): Promise<Person> {
  const email = `zzz_audit_${label}_${unique()}@example.test`
  createdEmails.push(email)
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email, idUserStatus: 2, authProvider: 'credentials' })
    .returning({ id: users.id }))
  return { id: row.id, email }
}

async function createTenant(): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-audit-${unique()}`.slice(0, 40)}, 'ZZZ Registro')::text as id`))
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

/** La sessione come la darebbe Auth.js dopo il callback jwt: tenant scelto, ruoli riletti dal database dalle guardie. */
function sessionOf(who: Person, tenantId: TenantId) {
  return {
    user: {
      id: who.id, email: who.email, name: 'ZZZ', roleIds: [], accountActive: true, provider: 'credentials',
      tenantState: 'ready', tenantId: Number(tenantId), tenantName: 'ZZZ Registro',
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

function navInput(name: string, overrides: Partial<CreateNavItemInput> = {}): CreateNavItemInput {
  return {
    name, idItemType: 2, idFunctionalityType: FUNCTYPE_EXTERNAL_LINK, functionalityLink: 'https://example.test/a',
    iconPath: null, idItemParent: null, description: '', itemTranslation: {}, tagTranslations: {}, ...overrides,
  }
}

async function userIdOf(email: string): Promise<string> {
  const [row] = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, email)))
  if (!row) throw new Error(`no user with email ${email}`)
  return row.id
}

/** Il permesso di assistenza di A, scritto dal fixture: valido per un'ora o tolto. */
async function setConsentOf(tenantId: TenantId, valid: boolean): Promise<void> {
  await withOwner(tx => tx.update(tenantSettings).set({ supportUntil: valid ? sql`now() + interval '1 hour'` : null }), tenantId)
}

async function setSelfRegistrationOf(tenantId: TenantId, enabled: boolean): Promise<void> {
  await withOwner(tx => tx.update(tenantSettings).set({ selfRegistration: enabled }), tenantId)
}

type AuditRow = {
  id: number
  idTenant: number | null
  operation: string
  objectType: string | null
  objectId: string | null
  actorKind: string
  actorUserId: string | null
  actorEmail: string | null
  details: unknown
}

/** Le voci del registro del tenant A, come proprietario (la RLS forzata vale anche per lui). */
async function tenantRows(tenantId: TenantId = A): Promise<AuditRow[]> {
  return withOwner(tx => tx.select({
    id: tenantAuditEvent.id, idTenant: tenantAuditEvent.idTenant, operation: tenantAuditEvent.operation, objectType: tenantAuditEvent.objectType,
    objectId: tenantAuditEvent.objectId, actorKind: tenantAuditEvent.actorKind, actorUserId: tenantAuditEvent.actorUserId,
    actorEmail: tenantAuditEvent.actorEmail, details: tenantAuditEvent.details,
  }).from(tenantAuditEvent).orderBy(asc(tenantAuditEvent.id)), tenantId)
}

/** Le voci del registro della piattaforma scritte dalle persone di questo test (le altre non sono sue). */
async function platformRows(): Promise<AuditRow[]> {
  const actors = [adminA.id, memberA.id, catalogAdmin.id, person.id, platformAdmin.id]
  return withOwner(tx => tx.select({
    id: platformAuditEvent.id, idTenant: platformAuditEvent.idTenant, operation: platformAuditEvent.operation, objectType: platformAuditEvent.objectType,
    objectId: platformAuditEvent.objectId, actorKind: platformAuditEvent.actorKind, actorUserId: platformAuditEvent.actorUserId,
    actorEmail: platformAuditEvent.actorEmail, details: platformAuditEvent.details,
  }).from(platformAuditEvent).where(inArray(platformAuditEvent.actorUserId, actors)).orderBy(asc(platformAuditEvent.id)))
}

const rowsOf = (sink: 'tenant' | 'platform') => (sink === 'tenant' ? tenantRows() : platformRows())

// ---------------------------------------------------------------------------------------------
// I casi
// ---------------------------------------------------------------------------------------------
interface ExpectedEntry {
  operation: AuditOperation
  objectType: string
  objectId: () => string | number | Promise<string | number>
}

interface AuditCase {
  /** L'export vero: confrontato con l'inventario. */
  entry: unknown
  sink: 'tenant' | 'platform'
  /** Chi riesce: l'amministratore di A (predefinito), l'amministratore di piattaforma o la persona che si registra. */
  as?: 'adminA' | 'platformAdmin' | 'self'
  /** La veste scritta nella voce: la persona del tenant (predefinita) o la piattaforma (console). */
  kind?: 'person' | 'platform'
  /** Prepara lo stato prima della chiamata che riesce. */
  arrange?: () => Promise<void>
  /** Una chiamata che dev'essere rifiutata; di norma la stessa `run` con la sessione di un membro senza permessi. */
  refuse?: () => Promise<void>
  run: () => Promise<void>
  expected: ExpectedEntry[]
  /** Chi risulta nella voce, se non è la sessione. */
  actor?: () => Promise<Person>
}

const CASES: Record<string, AuditCase> = {
  'lib/rbac/roles-actions.ts#createRole': {
    entry: createRole, sink: 'tenant',
    run: async () => { state.roleId = (await createRole(`ZZZ ruolo ${unique()}`)).id },
    expected: [{ operation: 'role.create', objectType: 'role', objectId: () => state.roleId }],
  },
  'lib/rbac/roles-actions.ts#renameRole': {
    entry: renameRole, sink: 'tenant',
    run: async () => { await renameRole(state.roleId, `ZZZ ruolo rinominato ${unique()}`) },
    expected: [{ operation: 'role.rename', objectType: 'role', objectId: () => state.roleId }],
  },
  'lib/rbac/navigation-actions.ts#createNavigationItem': {
    entry: createNavigationItem, sink: 'tenant',
    run: async () => { state.navId = (await createNavigationItem(navInput(`ZZZ voce ${unique()}`))).id },
    expected: [{ operation: 'menu.create', objectType: 'menu_entry', objectId: () => state.navId }],
  },
  'lib/rbac/navigation-actions.ts#updateNavigationItem': {
    entry: updateNavigationItem, sink: 'tenant',
    run: async () => { await updateNavigationItem(state.navId, navInput(`ZZZ voce modificata ${unique()}`)) },
    expected: [{ operation: 'menu.update', objectType: 'menu_entry', objectId: () => state.navId }],
  },
  'lib/rbac/navigation-actions.ts#moveNavigationItem': {
    entry: moveNavigationItem, sink: 'tenant',
    run: async () => { await moveNavigationItem(state.navId, { targetParentId: state.categoryId, orderPosition: 0 }) },
    expected: [{ operation: 'menu.move', objectType: 'menu_entry', objectId: () => state.navId }],
  },
  'lib/rbac/roles-actions.ts#updateRolePermissions': {
    entry: updateRolePermissions, sink: 'tenant',
    run: async () => {
      await updateRolePermissions(state.roleId, {
        operations: [{ idItem: readMenuPermission, authorization: true }],
        functionalities: [{ idItem: state.navId, authorization: true }],
      })
    },
    expected: [
      { operation: 'role.permissions', objectType: 'role', objectId: () => state.roleId },
      { operation: 'role.functionalities', objectType: 'role', objectId: () => state.roleId },
    ],
  },
  'lib/rbac/navigation-actions.ts#deleteNavigationItem': {
    entry: deleteNavigationItem, sink: 'tenant',
    run: async () => { await deleteNavigationItem(state.navId) },
    expected: [{ operation: 'menu.delete', objectType: 'menu_entry', objectId: () => state.navId }],
  },
  'lib/rbac/users-actions.ts#updateUserRoles': {
    entry: updateUserRoles, sink: 'tenant',
    run: async () => { await updateUserRoles(person.id, [state.roleId]) },
    expected: [{ operation: 'member.roles', objectType: 'user', objectId: () => person.id }],
  },
  'lib/rbac/users-actions.ts#setUserStatus': {
    entry: setUserStatus, sink: 'tenant',
    run: async () => { await setUserStatus(person.id, USER_STATUS_DEACTIVATED) },
    expected: [{ operation: 'member.status', objectType: 'user', objectId: () => person.id }],
  },
  'lib/rbac/users-actions.ts#addUserByEmail': {
    entry: addUserByEmail, sink: 'tenant',
    run: async () => {
      state.newMemberEmail = `zzz_audit_new_${unique()}@example.test`
      createdEmails.push(state.newMemberEmail)
      await addUserByEmail(state.newMemberEmail)
    },
    expected: [{ operation: 'member.add', objectType: 'user', objectId: () => userIdOf(state.newMemberEmail) }],
  },
  'lib/rbac/roles-actions.ts#deleteRole': {
    entry: deleteRole, sink: 'tenant',
    run: async () => { await deleteRole(state.roleId) },
    expected: [{ operation: 'role.delete', objectType: 'role', objectId: () => state.roleId }],
  },
  'lib/theme-actions.ts#saveAppTheme': {
    entry: saveAppTheme, sink: 'tenant',
    run: async () => {
      await saveAppTheme({ primaryColor: '#0a5d2c', primaryDark: null, surfaces: { light: {}, dark: {} } }, { acknowledgeWarnings: true })
    },
    expected: [{ operation: 'theme.save', objectType: 'app_theme', objectId: () => A }],
  },
  'lib/tenancy/tenant-settings-actions.ts#setSelfRegistration': {
    entry: setSelfRegistration, sink: 'tenant',
    arrange: () => setSelfRegistrationOf(A, false),
    run: async () => { await setSelfRegistration(true) },
    expected: [{ operation: 'settings.self_registration', objectType: 'tenant_settings', objectId: () => A }],
  },
  // Il permesso di assistenza è un'azione del tenant (MT5-DEC-20): solo nel registro del tenant.
  'lib/tenancy/support-consent-actions.ts#grantSupportConsent': {
    entry: grantSupportConsent, sink: 'tenant',
    run: async () => { await grantSupportConsent('1h') },
    expected: [{ operation: 'support.grant', objectType: 'tenant_settings', objectId: () => A }],
  },
  'lib/tenancy/support-consent-actions.ts#revokeSupportConsent': {
    entry: revokeSupportConsent, sink: 'tenant',
    arrange: () => setConsentOf(A, true),
    run: async () => { expect(await revokeSupportConsent()).toEqual({ ok: true }) },
    expected: [{ operation: 'support.revoke', objectType: 'tenant_settings', objectId: () => A }],
  },
  'app/api/admin/send-invite/route.ts#POST': {
    entry: sendInvite, sink: 'tenant',
    run: async () => {
      const response = await sendInvite(jsonRequest('/api/admin/send-invite', { userId: person.id }))
      expect(response.status).toBe(200)
    },
    expected: [{ operation: 'member.invite', objectType: 'user', objectId: () => person.id }],
  },
  'app/api/auth/register/route.ts#POST': {
    entry: register, sink: 'tenant', as: 'self',
    // Con le registrazioni autonome spente la risposta è la stessa e non nasce niente.
    refuse: async () => {
      await setSelfRegistrationOf(A, false)
      await registerOnHostA()
    },
    arrange: () => setSelfRegistrationOf(A, true),
    run: async () => { await registerOnHostA() },
    expected: [{ operation: 'member.join', objectType: 'user', objectId: () => userIdOf(state.registeredEmail) }],
    actor: async () => ({ id: await userIdOf(state.registeredEmail), email: state.registeredEmail }),
  },
  'lib/i18n/language-actions.ts#createLanguage': {
    entry: createLanguage, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      state.languageCode = unique().slice(-3).replace(/[0-9]/g, d => String.fromCharCode(97 + Number(d)))
      expect(await createLanguage(languageInput())).toEqual({ error: null })
      const [row] = await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage).where(eq(appLanguage.code, state.languageCode)))
      state.languageId = Number(row.id)
    },
    expected: [{ operation: 'language.create', objectType: 'language', objectId: () => state.languageId }],
  },
  'lib/i18n/language-actions.ts#updateLanguage': {
    entry: updateLanguage, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await updateLanguage(state.languageId, languageInput({ name: `zzz_i18n_test_${state.languageCode}_b` }))).toEqual({ error: null }) },
    expected: [{ operation: 'language.update', objectType: 'language', objectId: () => state.languageId }],
  },
  'lib/i18n/language-actions.ts#setDefaultLanguage': {
    entry: setDefaultLanguage, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    // Il predefinito di prima si rimette subito: due cambi, due voci.
    run: async () => {
      expect(await setDefaultLanguage(state.languageId)).toEqual({ error: null })
      expect(await setDefaultLanguage(originalDefaultLanguage)).toEqual({ error: null })
    },
    expected: [
      { operation: 'language.default', objectType: 'language', objectId: () => state.languageId },
      { operation: 'language.default', objectType: 'language', objectId: () => originalDefaultLanguage },
    ],
  },
  'lib/i18n/language-actions.ts#setLanguageActive': {
    entry: setLanguageActive, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await setLanguageActive(state.languageId, false)).toEqual({ error: null }) },
    expected: [{ operation: 'language.active', objectType: 'language', objectId: () => state.languageId }],
  },
  'lib/i18n/language-actions.ts#deleteLanguage': {
    entry: deleteLanguage, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await deleteLanguage(state.languageId)).toEqual({ error: null }) },
    expected: [{ operation: 'language.delete', objectType: 'language', objectId: () => state.languageId }],
  },
  'lib/i18n/translation-actions.ts#createTranslationKey': {
    entry: createTranslationKey, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      const created = await createTranslationKey({ key: testKey(`k${unique()}.label`), description: null, namespace: 'zzz_i18n_test', module: null })
      expect(created.error).toBeNull()
      state.keyId = created.id as number
    },
    expected: [{ operation: 'translation.key.create', objectType: 'translation_key', objectId: () => state.keyId }],
  },
  'lib/i18n/translation-actions.ts#saveTranslations': {
    entry: saveTranslations, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      const result = await saveTranslations({
        keyId: state.keyId, keyVersion: 1, description: null, namespace: 'zzz_i18n_test', module: null,
        values: [{ languageCode: 'it', value: 'Ciao', version: null }],
      })
      expect(result).toEqual({ ok: true })
    },
    expected: [{ operation: 'translation.save', objectType: 'translation_key', objectId: () => state.keyId }],
  },
  'lib/i18n/translation-actions.ts#deleteTranslationKey': {
    entry: deleteTranslationKey, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await deleteTranslationKey(state.keyId)).toEqual({ error: null }) },
    expected: [{ operation: 'translation.key.delete', objectType: 'translation_key', objectId: () => state.keyId }],
  },
  // La console: l'attore è l'amministratore di piattaforma, la veste è «platform», nessun tenant toccato.
  'lib/platform/platform-admin-actions.ts#addPlatformAdmin': {
    entry: addPlatformAdmin, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      state.platformAdminEmail = `zzz_audit_padmin_${unique()}@example.test`
      createdEmails.push(state.platformAdminEmail)
      expect(await addPlatformAdmin(state.platformAdminEmail)).toEqual({ ok: true, invited: true })
      // Nominato e senza ancora una password: nominarlo di nuovo rimanda l'invito e lo scrive (platform.admin.invite).
      expect(await addPlatformAdmin(state.platformAdminEmail)).toEqual({ ok: true, invited: true })
    },
    expected: [
      { operation: 'platform.admin.add', objectType: 'user', objectId: () => userIdOf(state.platformAdminEmail) },
      { operation: 'platform.admin.invite', objectType: 'user', objectId: () => userIdOf(state.platformAdminEmail) },
    ],
  },
  'lib/platform/platform-admin-actions.ts#removePlatformAdmin': {
    entry: removePlatformAdmin, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await removePlatformAdmin(await userIdOf(state.platformAdminEmail))).toEqual({ ok: true }) },
    expected: [{ operation: 'platform.admin.remove', objectType: 'user', objectId: () => userIdOf(state.platformAdminEmail) }],
  },
  // Il ciclo di vita di un tenant dalla console (Task 8): ogni azione scrive nel registro della
  // piattaforma (qui) e in quello del tenant (provato in lib/platform/tenant-actions.integration.test.ts).
  // Un tenant nuovo, poi i suoi indirizzi e amministratori, per ultimo la sospensione (che blocca gli inviti).
  'lib/platform/tenant-actions.ts#createTenant': {
    entry: createPlatformTenant, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      const adminEmail = `zzz_audit_first_${unique()}@example.test`
      createdEmails.push(adminEmail)
      const result = await createPlatformTenant({ name: 'ZZZ Console', slug: `zzz-audit-new-${unique()}`.slice(0, 40), adminEmail })
      if (!result.ok) throw new Error('the tenant was not created')
      expect(result.invited).toBe(true)
      state.consoleTenantId = result.tenantId
      createdTenants.push(tenantIdForTest(result.tenantId))
    },
    expected: [{ operation: 'tenant.create', objectType: 'tenant', objectId: () => state.consoleTenantId }],
  },
  'lib/platform/tenant-actions.ts#addTenantHost': {
    entry: addTenantHost, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      state.consoleHostA = `zzz-audit-ca-${unique()}.example.test`
      expect(await addTenantHost(state.consoleTenantId, state.consoleHostA, true)).toEqual({ ok: true })
    },
    // Il primo indirizzo è anche il principale: due voci.
    expected: [
      { operation: 'tenant.host.add', objectType: 'tenant_host', objectId: () => state.consoleHostA },
      { operation: 'tenant.host.primary', objectType: 'tenant_host', objectId: () => state.consoleHostA },
    ],
  },
  'lib/platform/tenant-actions.ts#setPrimaryHost': {
    entry: setPrimaryHost, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    arrange: async () => {
      state.consoleHostB = `zzz-audit-cb-${unique()}.example.test`
      expect(await addTenantHost(state.consoleTenantId, state.consoleHostB, false)).toEqual({ ok: true })
    },
    run: async () => { expect(await setPrimaryHost(state.consoleTenantId, state.consoleHostB)).toEqual({ ok: true }) },
    expected: [{ operation: 'tenant.host.primary', objectType: 'tenant_host', objectId: () => state.consoleHostB }],
  },
  'lib/platform/tenant-actions.ts#removeTenantHost': {
    entry: removeTenantHost, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await removeTenantHost(state.consoleTenantId, state.consoleHostA)).toEqual({ ok: true }) },
    expected: [{ operation: 'tenant.host.remove', objectType: 'tenant_host', objectId: () => state.consoleHostA }],
  },
  'lib/platform/tenant-actions.ts#addTenantAdmin': {
    entry: addTenantAdmin, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => {
      state.consoleAdminEmail = `zzz_audit_tadmin_${unique()}@example.test`
      createdEmails.push(state.consoleAdminEmail)
      expect(await addTenantAdmin(state.consoleTenantId, state.consoleAdminEmail)).toEqual({ ok: true, invited: true })
    },
    expected: [{ operation: 'tenant.admin.add', objectType: 'user', objectId: () => userIdOf(state.consoleAdminEmail) }],
  },
  'lib/platform/tenant-actions.ts#resendTenantInvite': {
    entry: resendTenantInvite, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await resendTenantInvite(state.consoleTenantId, await userIdOf(state.consoleAdminEmail))).toEqual({ ok: true, invited: true }) },
    expected: [{ operation: 'tenant.invite.resend', objectType: 'user', objectId: () => userIdOf(state.consoleAdminEmail) }],
  },
  // Ingresso e uscita di assistenza (MT5-DEC-20): nel registro della piattaforma (qui) e in quello del
  // tenant, con la veste della piattaforma (provato in lib/platform/support-actions.integration.test.ts).
  'lib/platform/support-actions.ts#startSupport': {
    entry: startSupport, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    refuse: async () => {
      // Chi non è amministratore di piattaforma, e la piattaforma senza permesso: nessuna voce.
      await expect(startSupport(Number(A), 'prova')).rejects.toThrow('Unauthorized')
      mocks.session = sessionOf(platformAdmin, A)
      await setConsentOf(A, false)
      await expect(startSupport(Number(A), 'prova')).rejects.toThrow('support_not_allowed')
    },
    arrange: () => setConsentOf(A, true),
    run: async () => { await startSupport(Number(A), 'prova') },
    expected: [{ operation: 'support.enter', objectType: 'tenant', objectId: () => A }],
  },
  'lib/platform/support-actions.ts#endSupport': {
    entry: endSupport, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    arrange: async () => {
      const session = sessionOf(platformAdmin, A)
      mocks.session = { ...session, user: { ...session.user, tenantState: 'support' } }
    },
    run: async () => { await endSupport() },
    expected: [{ operation: 'support.exit', objectType: 'tenant', objectId: () => A }],
  },
  'lib/platform/tenant-actions.ts#setTenantStatus': {
    entry: setTenantStatus, sink: 'platform', as: 'platformAdmin', kind: 'platform',
    run: async () => { expect(await setTenantStatus(state.consoleTenantId, 'suspended', 'prova')).toEqual({ ok: true }) },
    expected: [{ operation: 'tenant.status', objectType: 'tenant', objectId: () => state.consoleTenantId }],
  },
}

function languageInput(over: Partial<{ name: string; isActive: boolean }> = {}) {
  return {
    code: state.languageCode, locale: `${state.languageCode}-ZZ`, name: `zzz_i18n_test_${state.languageCode}`,
    nativeName: `zzz_i18n_test_${state.languageCode}`, isActive: true, ...over,
  }
}

async function registerOnHostA(): Promise<void> {
  state.registeredEmail = `zzz_audit_reg_${unique()}@${allowedDomain}`
  createdEmails.push(state.registeredEmail)
  mocks.headers = new Headers({ host: hostA })
  const response = await register(jsonRequest('/api/auth/register', { email: state.registeredEmail }))
  // La risposta è neutra in ogni caso.
  expect(await response.json()).toEqual({ ok: true })
}

const entryKey = (entry: { file: string; name: string }) => `${entry.file}#${entry.name}`

/** Le pagine e i gestori di sola lettura non modificano dati: non hanno bisogno di caso né esenzione. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const writingDoors = () => listEntryPoints().filter(entry =>
  entry.kind === 'action' || (entry.kind === 'route' && !READ_METHODS.has(entry.name)))

describe('audit coverage of the entry points', () => {
  it('every door that can write has an audit case or a motivated exemption', () => {
    const missing = writingDoors().map(entryKey).filter(key => !(key in CASES) && !(key in EXEMPT))
    expect(missing).toEqual([])
  })

  it('no door is both a case and an exemption, and every exemption says why', () => {
    expect(Object.keys(CASES).filter(key => key in EXEMPT)).toEqual([])
    for (const [key, reason] of Object.entries(EXEMPT)) expect(reason.trim().length, key).toBeGreaterThan(20)
  })

  it('every case and exemption names a door that still exists', () => {
    const known = new Set(writingDoors().map(entryKey))
    expect([...Object.keys(CASES), ...Object.keys(EXEMPT)].filter(key => !known.has(key))).toEqual([])
  })

  it('every case exercises the export its key names', async () => {
    const mismatched: string[] = []
    for (const [key, { entry }] of Object.entries(CASES)) {
      const [file, name] = key.split('#')
      const exported = await import(resolve(process.cwd(), file)) as Record<string, unknown>
      if (exported[name] !== entry) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('every audit operation code is unique and stable in shape', () => {
    expect(new Set(AUDIT_OPERATIONS).size).toBe(AUDIT_OPERATIONS.length)
    for (const code of AUDIT_OPERATIONS) expect(code).toMatch(/^[a-z]+(\.[a-z_]+)+$/)
  })
})

describeIntegration('every door that writes records its audit row in the same transaction', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    A = await createTenant()
    adminA = await createUser('admin')
    memberA = await createUser('member')
    person = await createUser('person')
    catalogAdmin = await createUser('catalog')
    platformAdmin = await createUser('platform')
    // L'attributo lo scrive solo il proprietario (un trigger lo nega al ruolo dell'app).
    await withOwner(tx => tx.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, platformAdmin.id)))
    await addMember(A, adminA.id, true)
    await addMember(A, memberA.id, false)
    await addMember(A, person.id, false)
    await addMember(DEFAULT, catalogAdmin.id, true)

    await withTenant(A, async tx => {
      const [category] = await tx.insert(menuEntry).values({ name: 'ZZZ cartella di prova' }).returning({ id: menuEntry.idMenuEntry })
      state.categoryId = category.id
    })
    const [perm] = await withGlobal(tx => tx.select({ id: permission.idPermission }).from(permission).where(eq(permission.code, 'read-menu')))
    readMenuPermission = perm.id
    const [original] = await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage).where(eq(appLanguage.isDefault, true)))
    originalDefaultLanguage = Number(original.id)

    // Una registrazione dall'indirizzo di A: dominio consentito e indirizzo dedicato.
    allowedDomain = `zzz-audit-${unique()}.example.test`
    hostA = `zzz-audit-${unique()}.example.test`
    await withOwner(async tx => {
      await tx.insert(allowedDomains).values({ domain: allowedDomain, active: true })
      await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${hostA}, ${A}, true)`)
    })
  }, 90_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    // Il predefinito di prima torna com'era, qualunque cosa sia successa.
    await step(() => withGlobal(async tx => {
      await tx.update(appLanguage).set({ isDefault: false }).where(eq(appLanguage.isDefault, true))
      await tx.update(appLanguage).set({ isDefault: true }).where(eq(appLanguage.idLanguage, originalDefaultLanguage))
    }))
    await step(cleanupTestData)
    await step(() => withOwner(tx => tx.delete(platformAuditEvent).where(inArray(
      platformAuditEvent.actorUserId, [adminA.id, memberA.id, catalogAdmin.id, person.id, platformAdmin.id, TEST_ACTOR_ID]))))
    await step(() => withOwner(tx => tx.delete(allowedDomains).where(eq(allowedDomains.domain, allowedDomain))))
    if (createdEmails.length > 0) {
      await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.email, createdEmails))))
    }
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  beforeEach(() => {
    mocks.session = sessionOf(adminA, A)
    mocks.headers = new Headers({ host: 'localhost:3000' })
  })

  for (const [key, c] of Object.entries(CASES)) {
    const operations = c.expected.map(entry => entry.operation).join(' + ')
    it(`${key}: refused writes no audit row, a success writes ${operations} in the ${c.sink} audit`, async () => {
      // Rifiutata: la stessa chiamata con la sessione di un membro senza permessi (o la condizione del caso).
      const before = await rowsOf(c.sink)
      mocks.session = sessionOf(memberA, A)
      await (c.refuse ?? (async () => { await c.run().catch(() => undefined) }))()
      expect(await rowsOf(c.sink), 'a refused call left an audit row').toEqual(before)

      // Riuscita: voci attese, nello stesso ordine, scritte da chi ha agito.
      const signedIn = c.as === 'platformAdmin' ? platformAdmin : adminA
      mocks.session = sessionOf(signedIn, A)
      await c.arrange?.()
      const lastId = (await rowsOf(c.sink)).reduce((max, row) => Math.max(max, row.id), 0)
      await c.run()
      const written = (await rowsOf(c.sink)).filter(row => row.id > lastId)

      expect(written.map(row => row.operation)).toEqual(c.expected.map(entry => entry.operation))
      const actor = c.actor ? await c.actor() : signedIn
      for (const [index, expected] of c.expected.entries()) {
        expect(written[index].objectType).toBe(expected.objectType)
        expect(written[index].objectId).toBe(String(await expected.objectId()))
        expect(written[index].actorKind).toBe(c.kind ?? 'person')
        expect(written[index].actorUserId).toBe(actor.id)
        // L'email è quella dell'account al momento dell'azione.
        expect(written[index].actorEmail).toBe(actor.email)
      }
    }, 30_000)
  }

  it('createRole writes role.create in the tenant audit of the actor tenant', async () => {
    const defaultBefore = await tenantRows(DEFAULT)
    const platformBefore = await platformRows()
    const name = `ZZZ ruolo per il registro ${unique()}`
    const { id } = await createRole(name)

    const written = (await tenantRows()).filter(row => row.operation === 'role.create' && row.objectId === String(id))
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      objectType: 'role', actorKind: 'person', actorUserId: adminA.id, actorEmail: adminA.email, details: { name },
    })
    // Nel registro del tenant dell'attore, e in nessun altro.
    expect(await tenantRows(DEFAULT)).toEqual(defaultBefore)
    // E non nel registro della piattaforma: i ruoli sono dati di tenant.
    expect(await platformRows()).toEqual(platformBefore)
  })

  it('a refused updateUserRoles writes no audit row', async () => {
    const before = await tenantRows()
    // Senza il permesso: rifiutata dalla guardia, prima di aprire la transazione.
    mocks.session = sessionOf(memberA, A)
    await expect(updateUserRoles(person.id, [])).rejects.toThrow('Unauthorized')
    // Con il permesso ma contro una persona che non è del tenant: rifiutata dentro la transazione.
    mocks.session = sessionOf(adminA, A)
    await expect(updateUserRoles(catalogAdmin.id, [])).rejects.toThrow('La persona non fa parte di questo tenant')
    expect(await tenantRows()).toEqual(before)
  })

  it('a change that fails after its audit row was written leaves neither', async () => {
    const before = await tenantRows()
    const name = `ZZZ ruolo annullato ${unique()}`
    const { recordTenantAudit } = await import('./tenant-audit')
    await expect(withTenant(A, async tx => {
      await tx.insert(role).values({ description: name, idRoleType: 2 })
      await recordTenantAudit(tx, { userId: adminA.id, email: null, kind: 'person' }, { operation: 'role.create', objectType: 'role', objectId: 1 })
      throw new Error('the change fails after the audit insert')
    })).rejects.toThrow('the change fails')
    expect(await tenantRows()).toEqual(before)
    const left = await withTenant(A, tx => tx.select({ id: role.idRole }).from(role).where(eq(role.description, name)))
    expect(left).toEqual([])
  })

  it('an audit row that cannot be written stops the change', async () => {
    const name = `ZZZ ruolo senza registro ${unique()}`
    const { recordTenantAudit } = await import('./tenant-audit')
    // Un id di persona che non è un uuid: l'inserimento nel registro fallisce e la modifica non resta.
    await expect(withTenant(A, async tx => {
      await tx.insert(role).values({ description: name, idRoleType: 2 })
      await recordTenantAudit(tx, { userId: 'not-a-uuid', email: null, kind: 'person' }, { operation: 'role.create', objectType: 'role', objectId: 1 })
    })).rejects.toThrow()
    const left = await withTenant(A, tx => tx.select({ id: role.idRole }).from(role).where(eq(role.description, name)))
    expect(left).toEqual([])
  })

  it('language and translation writes go to the platform audit, not to a tenant audit', async () => {
    mocks.session = sessionOf(platformAdmin, A)
    const defaultBefore = await tenantRows(DEFAULT)
    const platformBefore = await platformRows()
    const created = await createTranslationKey({ key: testKey(`k${unique()}.label`), description: null, namespace: 'zzz_i18n_test', module: null })
    expect(created.error).toBeNull()
    expect(await deleteTranslationKey(created.id as number)).toEqual({ error: null })

    const written = (await platformRows()).slice(platformBefore.length)
    expect(written.map(row => row.operation)).toEqual(['translation.key.create', 'translation.key.delete'])
    // L'amministratore di piattaforma agisce come piattaforma, con il proprio account (MT5-DEC-14, MT5-DEC-24).
    expect(written.every(row => row.actorKind === 'platform' && row.actorUserId === platformAdmin.id && row.actorEmail === platformAdmin.email)).toBe(true)
    // Nessun tenant toccato: le righe della piattaforma per lingue e traduzioni non portano un tenant.
    expect(written.map(row => row.idTenant)).toEqual([null, null])
    // Il registro del tenant dell'attore non cambia: le lingue e le traduzioni non sono dati di tenant.
    expect(await tenantRows(DEFAULT)).toEqual(defaultBefore)
  })

  it('first sign-in into the default tenant writes member.join and member.roles, a second sign-in writes nothing', async () => {
    const newcomer = await createUser('signin')
    // Il predefinito accetta registrazioni autonome (MT4-DEC-10) solo se l'interruttore è acceso: acceso per il test, rimesso com'era.
    const [settings] = await withOwner(tx => tx.select({ on: tenantSettings.selfRegistration }).from(tenantSettings), DEFAULT)
    await withOwner(tx => tx.update(tenantSettings).set({ selfRegistration: true }), DEFAULT)
    try {
      const before = await tenantRows(DEFAULT)
      // L'ingresso vero del callback jwt al primo accesso (due transazioni: l'appartenenza, poi il ruolo base).
      const first = await enterTenant(newcomer.id, null, { current: null, firstEntry: true })
      expect(first).toMatchObject({ tenantState: 'ready', accountActive: true })
      const written = (await tenantRows(DEFAULT)).filter(row => !before.some(old => old.id === row.id))
      expect(written.map(row => row.operation)).toEqual(['member.join', 'member.roles'])
      for (const row of written) {
        expect(row).toMatchObject({
          objectType: 'user', objectId: newcomer.id, actorKind: 'person', actorUserId: newcomer.id, actorEmail: newcomer.email,
        })
      }
      expect(written[1].details).toEqual({ systemKey: 'REGISTERED' })

      // Il secondo accesso non crea niente, quindi non scrive niente.
      const afterFirst = await tenantRows(DEFAULT)
      await enterTenant(newcomer.id, null, { current: null, firstEntry: true })
      expect(await tenantRows(DEFAULT)).toEqual(afterFirst)
    } finally {
      await withOwner(tx => tx.update(tenantSettings).set({ selfRegistration: settings.on }), DEFAULT)
    }
  })

  it('details never contain password, token or link keys', async () => {
    // L'invito è la modifica più vicina a un segreto: il token nasce nella stessa transazione.
    const before = await tenantRows()
    const response = await sendInvite(jsonRequest('/api/admin/send-invite', { userId: person.id }))
    expect(response.status).toBe(200)
    const invite = (await tenantRows()).filter(row => !before.some(old => old.id === row.id))
    expect(invite.map(row => row.operation)).toEqual(['member.invite'])

    // Tutte le voci scritte da questo file, di entrambi i registri, a ogni livello dei dettagli.
    const forbidden = /password|token|link|secret/i
    const keysOf = (value: unknown): string[] => Array.isArray(value)
      ? value.flatMap(keysOf)
      : value !== null && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
        : []
    const all = [...await tenantRows(), ...await platformRows()]
    expect(all.length).toBeGreaterThan(0)
    for (const row of all) expect(keysOf(row.details).filter(key => forbidden.test(key)), row.operation).toEqual([])

    // E nessun valore che somigli al token appena creato (un uuid) nelle voci del tenant.
    const tokens = await withOwner(tx => tx.execute<{ token: string }>(
      sql`select token from public.password_set_tokens where user_id = ${person.id}::uuid`))
    const serialized = JSON.stringify(all.map(row => row.details))
    for (const { token } of tokens) expect(serialized).not.toContain(token)
  })
})
