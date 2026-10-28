import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { appLanguage, role, tenant as tenantTable, tenantMembership, tenantSettings, translationKey, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform } from './db'

/**
 * L'accesso di assistenza (specifica 2026-10-26, MT5-DEC-10, 11, 12, 19, 20; MT5-RISK-2) contro il
 * database vero: il permesso del tenant, l'ingresso dalla console, la rivalidazione del token a ogni
 * richiesta, le modifiche durante l'assistenza e l'uscita.
 *
 * Il token si muove come in Auth.js: ogni «richiesta» passa da `revalidateTokenTenant` (il callback
 * jwt), un `unstable_update` da `updateTokenTenant`, e la sessione delle guardie si ricava dal token
 * con la stessa funzione del callback `session`. Finti sono solo i confini di Next (intestazioni,
 * cache di React, revalidatePath) e Auth.js stesso; la guardia, l'attore, le porte del database e i
 * due registri sono veri. Il tempo non si aspetta: si sposta la scadenza nel database.
 */
const mocks = vi.hoisted(() => ({
  host: 'localhost:3000',
  // La persona della sessione e il suo token, come li terrebbe il cookie.
  who: null as null | { id: string; email: string },
  token: {} as Record<string, unknown>,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: mocks.host }) }))
vi.mock('next/cache', async importOriginal => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidatePath: () => undefined,
}))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => sessionNow() }))
vi.mock('@/lib/mailer', () => ({ sendEmail: async () => undefined }))
vi.mock('@/lib/auth', () => ({
  auth: async () => sessionNow(),
  // Come Auth.js: il callback jwt con trigger 'update' riceve il carico, poi la sessione si rilegge dal token.
  unstable_update: async (payload: unknown) => {
    const { updateTokenTenant } = await import('@/lib/tenancy/token-tenant')
    mocks.token = { ...mocks.token, ...(await updateTokenTenant(mocks.who!.id, mocks.token, hostNow(), payload)) }
    return sessionNow()
  },
}))

const { revalidateTokenTenant, enterTenant, updateTokenTenant, sessionTenantOf } = await import('@/lib/tenancy/token-tenant')
const { startSupport, endSupport } = await import('./support-actions')
const { createLanguage } = await import('@/lib/i18n/language-actions')
const { createTranslationKey } = await import('@/lib/i18n/translation-actions')
const { addPlatformAdmin } = await import('./platform-admin-actions')
const { requirePlatformAdmin, requirePlatformAdminPage } = await import('@/lib/rbac/auth-guard')
const { POST: platformAuditGrid } = await import('@/app/api/platform/audit-grid/route')
const { POST: tenantAuditGrid } = await import('@/app/api/audit/tenant-grid/route')
const { grantSupportConsent, revokeSupportConsent } = await import('@/lib/tenancy/support-consent-actions')
const { createRole } = await import('@/lib/rbac/roles-actions')
const { requirePermission } = await import('@/lib/rbac/auth-guard')
const { resolveRequestTenant } = await import('@/lib/tenancy/request-tenant')
const { chooseTenant } = await import('@/lib/tenancy/tenant-actions')
const { getTenantForPlatform } = await import('./tenant-service')
const { setTenantStatus } = await import('./tenant-actions')
const { addUserByEmail, setUserStatus, updateUserRoles } = await import('@/lib/rbac/users-actions')
const { POST: sendInvite } = await import('@/app/api/admin/send-invite/route')
const { readSupportInProgress } = await import('@/lib/tenancy/support-consent')
const { NextRequest } = await import('next/server')

const MAIN = 'localhost:3000'
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
let templateId: TenantId
let defaultTemplateAuditMax = 0

type Person = { id: string; email: string }
let platformAdmin: Person
let otherPlatformAdmin: Person

function hostNow(): string | null {
  return mocks.host.split(':')[0]
}

/** La sessione che il callback `session` darebbe dal token di adesso. */
function sessionNow() {
  if (!mocks.who) return null
  const accountActive = mocks.token.accountActive === true
  return {
    user: { id: accountActive ? mocks.who.id : '', email: mocks.who.email, accountActive, provider: 'credentials', ...sessionTenantOf(mocks.token) },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

/** Accede come la persona dall'indirizzo di adesso: il token come all'accesso. */
async function signIn(person: Person): Promise<void> {
  mocks.who = person
  mocks.token = { ...(await enterTenant(person.id, hostNow(), { current: null, firstEntry: false })) }
}

/** Una richiesta: il callback jwt rivalida il token, come a ogni richiesta. */
async function nextRequest(): Promise<Record<string, unknown>> {
  mocks.token = { ...mocks.token, ...(await revalidateTokenTenant(mocks.who!.id, mocks.token, hostNow())) }
  return mocks.token
}

async function createAccount(label: string, options: { platformAdmin?: boolean } = {}): Promise<Person> {
  const email = `zzz_sup_${label}_${unique()}@example.test`
  const [row] = await withOwner(tx => tx.insert(users).values({
    email, authProvider: 'credentials', idUserStatus: 2, passwordHash: 'x', isPlatformAdmin: options.platformAdmin ?? false,
  }).returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function seedTenant(label: string, options: { host?: string } = {}): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-sup-${label}-${unique()}`.slice(0, 40)}, ${`ZZZ ${label}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  if (options.host) {
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${options.host}, ${id}, true)`))
  }
  return id
}

async function seedAdmin(tenantId: TenantId, label: string): Promise<Person> {
  const person = await createAccount(label)
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: person.id, status: 'active' })
    await tx.insert(userRole).values([{ userId: person.id, idRole: system.registered }, { userId: person.id, idRole: system.tenantAdmin }])
  })
  return person
}

/** Una persona che esiste già diventa membro semplice del tenant (ruolo base). */
async function addMember(tenantId: TenantId, person: Person): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: person.id, status: 'active' })
    await tx.insert(userRole).values({ userId: person.id, idRole: system.registered })
  })
}

// Fix round 1 del Task 10: la console è chiusa in assistenza. Una persona della piattaforma in
// assistenza agisce nel tenant, e quelle modifiche vanno nel registro del tenant; le azioni della
// console (cataloghi globali compresi) non scrivono in nessun registro del tenant, quindi non
// passano di lì. Per uscire c'è `endSupport`, con la sua guardia.
describeIntegration('the console is closed during support', () => {
  const gridRequest = (path: string, body: unknown) => new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })

  async function inSupport(label: string): Promise<TenantId> {
    const tenant = await seedTenant(label)
    const admin = await seedAdmin(tenant, `${label}-admin`)
    await grantAs(admin)
    await signIn(platformAdmin)
    expect(await startSupport(Number(tenant), 'verifica')).toEqual({ state: 'support' })
    expect((await nextRequest()).tenantState).toBe('support')
    return tenant
  }

  it('refuses a catalog write, and the catalog does not change', async () => {
    await inSupport('closed-catalog')
    const code = unique().slice(-3).replace(/[0-9]/g, d => String.fromCharCode(97 + Number(d)))
    const keysBefore = (await withGlobal(tx => tx.select({ id: translationKey.idTranslationKey }).from(translationKey))).length
    const languagesBefore = (await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage))).length

    await expect(createLanguage({ code, locale: `${code}-ZZ`, name: `zzz_i18n_test_${code}`, nativeName: `zzz_i18n_test_${code}`, isActive: true }))
      .rejects.toThrow('Unauthorized')
    await expect(createTranslationKey({ key: `zzz_i18n_test_closed${unique()}.label`, description: null, namespace: 'zzz_i18n_test', module: null }))
      .rejects.toThrow('Unauthorized')

    expect((await withGlobal(tx => tx.select({ id: appLanguage.idLanguage }).from(appLanguage))).length).toBe(languagesBefore)
    expect((await withGlobal(tx => tx.select({ id: translationKey.idTranslationKey }).from(translationKey))).length).toBe(keysBefore)
  }, 60_000)

  it('refuses the console actions, the console pages and the console grids', async () => {
    const victim = await seedTenant('closed-victim')
    await inSupport('closed-actions')

    await expect(setTenantStatus(Number(victim), 'suspended')).rejects.toThrow('Unauthorized')
    const [row] = await withGlobal(tx => tx.select({ status: tenantTable.status }).from(tenantTable).where(eq(tenantTable.id, victim)))
    expect(row.status).toBe('active')
    await expect(addPlatformAdmin(`zzz_closed_${unique()}@example.test`)).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    // Le pagine della console rispondono 404, la rotta 403.
    await expect(requirePlatformAdminPage()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', { page: 0, size: 10 }))).status).toBe(403)
  }, 60_000)

  it('refuses to start support from inside support, and writes nothing', async () => {
    const tenant = await inSupport('closed-start')
    const other = await seedTenant('closed-start-other')
    const before = await tenantAuditOf(tenant)
    await expect(startSupport(Number(other), 'dal di dentro')).rejects.toThrow('Unauthorized')
    expect(await tenantAuditOf(tenant)).toEqual(before)
    expect(await tenantAuditOf(other)).toEqual([])
    expect(await nextRequest()).toMatchObject({ tenantState: 'support', tenantId: Number(tenant) })
  }, 60_000)

  it('still lets the platform admin leave, and the console works again right after', async () => {
    const tenant = await inSupport('closed-exit')
    expect(await endSupport()).toMatchObject({ state: 'none' })
    expect((await tenantAuditOf(tenant)).map(row => row.operation)).toEqual(['support.grant', 'support.enter', 'support.exit'])
    await nextRequest()
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ userId: platformAdmin.id })
    await expect(requirePlatformAdminPage()).resolves.toMatchObject({ userId: platformAdmin.id })
  }, 60_000)

  it('endSupport outside support answers a platform admin without writing, and refuses anyone else', async () => {
    const tenant = await seedTenant('closed-exit-outside')
    await signIn(platformAdmin)
    const before = await tenantAuditOf(tenant)
    const platformBefore = await platformAuditOf(tenant)
    // Come dopo una scadenza: il client carica la console, senza errore e senza voci nuove.
    expect(await endSupport()).toMatchObject({ state: 'none' })
    expect(await tenantAuditOf(tenant)).toEqual(before)
    expect(await platformAuditOf(tenant)).toEqual(platformBefore)

    const plain = await createAccount('closed-plain')
    await signIn(plain)
    await expect(endSupport()).rejects.toThrow('Unauthorized')
    expect(await tenantAuditOf(tenant)).toEqual(before)
    expect(await platformAuditOf(tenant)).toEqual(platformBefore)
  }, 60_000)

  it('outside support the console works as before', async () => {
    await signIn(platformAdmin)
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ userId: platformAdmin.id })
    expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', { page: 0, size: 10 }))).status).toBe(200)
  }, 30_000)

  // Una sessione di assistenza vera passa dalla rotta del registro del tenant e vede solo il tenant assistito.
  it('the tenant audit grid serves a support session only the rows of the supported tenant', async () => {
    const supported = await seedTenant('closed-audit-a')
    const adminA = await seedAdmin(supported, 'closed-audit-a-admin')
    await grantAs(adminA)
    const other = await seedTenant('closed-audit-b')
    const marker = `zzzsupportmark${unique()}`
    await withOwner(tx => tx.execute(sql`insert into public.tenant_audit_event (actor_kind, actor_email, operation, object_type, object_id)
      values ('person', ${`zzz_${marker}@example.test`}, 'role.create', 'role', ${marker})`), other)
    await signIn(platformAdmin)
    await startSupport(Number(supported), 'registro')
    await nextRequest()

    const response = await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { page: 0, size: 200 }))
    expect(response.status).toBe(200)
    const body = await response.json() as { rows: { operation: string; actorKind: string }[]; total: number }
    expect(JSON.stringify(body)).not.toContain(marker)
    // L'ingresso in assistenza è lì, con la veste della piattaforma; le altre voci sono tutte del tenant assistito.
    expect(body.rows.find(row => row.operation === 'support.enter')).toMatchObject({ actorKind: 'platform' })
    const own = await tenantAuditOf(supported)
    expect(body.total).toBe(own.length)
  }, 60_000)
})

/** Il permesso concesso come lo concede l'amministratore del tenant, con la sua sessione vera. */
async function grantAs(admin: Person, duration: '1h' | '1d' | '1w' = '1d') {
  const before = { who: mocks.who, token: mocks.token }
  await signIn(admin)
  const result = await grantSupportConsent(duration)
  mocks.who = before.who
  mocks.token = before.token
  return result
}

/** Sposta l'orologio: la scadenza del permesso è già passata. */
const expireConsent = (tenantId: TenantId) =>
  withOwner(tx => tx.update(tenantSettings).set({ supportUntil: sql`now() - interval '1 second'` }), tenantId)

const setStatus = (tenantId: TenantId, status: 'active' | 'suspended') =>
  withOwner(tx => tx.execute(sql`update public.tenant set status = ${status} where id = ${tenantId}`))

/** Un cambio di stato con l'azione vera della console (stato e voce `tenant.status`), come la persona della sessione. */
async function setPlatformTenantStatus(tenantId: TenantId, status: 'active' | 'suspended'): Promise<void> {
  // La console è chiusa in assistenza: il cambio lo fa la piattaforma con una sessione fuori dall'assistenza
  // (come `grantAs` per l'amministratore del tenant), e il token fermo della prova torna com'era.
  const before = { who: mocks.who, token: mocks.token }
  await signIn(platformAdmin)
  expect(await setTenantStatus(Number(tenantId), status)).toEqual({ ok: true })
  mocks.who = before.who
  mocks.token = before.token
}

const setPlatformAdmin = (userId: string, on: boolean) =>
  withOwner(tx => tx.update(users).set({ isPlatformAdmin: on }).where(eq(users.id, userId)))

type AuditRow = { id: number; operation: string; actor_kind: string; actor_user_id: string | null; actor_email: string | null; object_type: string | null; object_id: string | null; details: Record<string, unknown> }

async function tenantAuditOf(tenantId: TenantId): Promise<AuditRow[]> {
  return withOwner(tx => tx.execute<AuditRow>(sql`
    select id::int as id, operation, actor_kind, actor_user_id, actor_email, object_type, object_id, details
    from public.tenant_audit_event order by id`), tenantId)
}

async function platformAuditOf(tenantId: TenantId): Promise<AuditRow[]> {
  return withOwner(tx => tx.execute<AuditRow>(sql`
    select id::int as id, operation, actor_kind, actor_user_id, actor_email, object_type, object_id, details
    from public.platform_audit_event where id_tenant = ${tenantId} order by id`))
}

async function consentOf(tenantId: TenantId) {
  const [row] = await withOwner(tx => tx.select({ until: tenantSettings.supportUntil, by: tenantSettings.supportGrantedBy })
    .from(tenantSettings), tenantId)
  return row
}

async function rolesNamed(tenantId: TenantId, name: string) {
  return withOwner(tx => tx.select({ id: role.idRole }).from(role).where(eq(role.description, name)), tenantId)
}

beforeAll(async () => {
  const [found] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
  templateId = tenantIdForTest(Number(found.id))
  const [max] = await withOwner(tx => tx.execute<{ max: number }>(sql`select coalesce(max(id), 0)::int as max from public.tenant_audit_event`), templateId)
  defaultTemplateAuditMax = max.max
  platformAdmin = await createAccount('platform', { platformAdmin: true })
  otherPlatformAdmin = await createAccount('platform2', { platformAdmin: true })
}, 60_000)

afterAll(async () => {
  const errors: unknown[] = []
  const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
  // Le voci che questo file ha lasciato nel modello (ingresso e uscita di assistenza): il modello vive in ogni database di test.
  await step(() => withOwner(tx => tx.execute(sql`delete from public.tenant_audit_event where id > ${defaultTemplateAuditMax}
    and actor_user_id = any(${`{${[platformAdmin.id, otherPlatformAdmin.id].join(',')}}`}::uuid[])`), templateId))
  await step(() => withOwner(tx => tx.execute(sql`delete from public.platform_audit_event
    where actor_user_id = any(${`{${[platformAdmin.id, otherPlatformAdmin.id].join(',')}}`}::uuid[])`)))
  for (const id of createdTenants) await step(() => deleteTenantForTest(id))
  if (createdUserIds.length > 0) await step(() => withOwner(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
  await step(() => closePlatform())
  await step(() => closeOwner())
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => {
  mocks.host = MAIN
  mocks.who = null
  mocks.token = {}
})

describeIntegration('support access only with the tenant consent (MT5-DEC-10, MT5-RISK-2)', () => {
  it('without consent startSupport is refused and nothing is written', async () => {
    const tenant = await seedTenant('none')
    const admin = await seedAdmin(tenant, 'none-admin')
    await signIn(platformAdmin)
    const tokenBefore = { ...mocks.token }

    // Mai concesso.
    await expect(startSupport(Number(tenant), 'controllo')).rejects.toThrow()
    // Concesso e scaduto.
    await grantAs(admin)
    await expireConsent(tenant)
    await expect(startSupport(Number(tenant), 'controllo')).rejects.toThrow()
    // Concesso e valido, ma il tenant è sospeso (MT5-DEC-10: in un tenant sospeso non si entra).
    await grantAs(admin)
    await setStatus(tenant, 'suspended')
    await expect(startSupport(Number(tenant), 'controllo')).rejects.toThrow()
    await setStatus(tenant, 'active')
    // Chi non è amministratore di piattaforma, con il permesso valido: la guardia rifiuta.
    await signIn(admin)
    await expect(startSupport(Number(tenant), 'controllo')).rejects.toThrow('Unauthorized')
    // Senza motivo scritto (MT5-DEC-9).
    await signIn(platformAdmin)
    await expect(startSupport(Number(tenant), '   ')).rejects.toThrow()

    expect((await tenantAuditOf(tenant)).filter(row => row.operation.startsWith('support.enter'))).toEqual([])
    expect(await platformAuditOf(tenant)).toEqual([])
    expect(await nextRequest()).toMatchObject({ tenantState: tokenBefore.tenantState, tenantId: null })

    // Un aggiornamento della sessione scritto dal client non apre l'assistenza: senza la voce
    // d'ingresso dell'azione il callback jwt non ci crede, anche con il permesso valido.
    const forged = await updateTokenTenant(platformAdmin.id, mocks.token, hostNow(), { user: { supportTenantId: Number(tenant) } })
    expect(forged.tenantState).not.toBe('support')
    expect(forged.tenantId).toBeNull()
  }, 60_000)

  it('with consent the platform admin is ready-like in that tenant only, until the expiry', async () => {
    const tenant = await seedTenant('ok')
    const other = await seedTenant('other')
    const admin = await seedAdmin(tenant, 'ok-admin')
    const otherAdmin = await seedAdmin(other, 'other-admin')

    // La durata si calcola con l'orologio del database: un giorno da adesso.
    const granted = await grantAs(admin, '1d')
    const [clock] = await withOwner(tx => tx.execute<{ low: string; high: string }>(sql`
      select (now() + interval '1 day' - interval '1 minute')::text as low, (now() + interval '1 day' + interval '1 minute')::text as high`))
    expect(Date.parse(granted.until)).toBeGreaterThan(Date.parse(clock.low))
    expect(Date.parse(granted.until)).toBeLessThan(Date.parse(clock.high))
    expect(await consentOf(tenant)).toMatchObject({ by: admin.id })
    await grantAs(otherAdmin, '1w')

    await signIn(platformAdmin)
    // La scheda della console mostra lo stato del permesso, e nient'altro di chi l'ha concesso (MT5-OK-2).
    expect((await getTenantForPlatform(Number(tenant)))?.support).toEqual({ until: granted.until })
    expect(await startSupport(Number(tenant), 'verifica di un menu')).toEqual({ state: 'support' })
    const system = await withTenant(tenant, tx => getSystemRoleIds(tx))
    expect(mocks.token).toMatchObject({
      tenantState: 'support', tenantId: Number(tenant), accountActive: true, roleIds: [system.tenantAdmin],
      supportUntil: granted.until, supportReason: 'verifica di un menu', isPlatformAdmin: true,
    })
    expect(sessionNow()!.user).toMatchObject({ tenantState: 'support', tenantId: Number(tenant), supportUntil: granted.until })

    // Le richieste dopo restano nel tenant, come un amministratore del tenant (MT5-DEC-12).
    await nextRequest()
    expect(mocks.token).toMatchObject({ tenantState: 'support', tenantId: Number(tenant) })
    expect(await resolveRequestTenant()).toBe(Number(tenant))
    const actor = await requirePermission('manage-roles')
    expect(actor).toMatchObject({ tenantId: Number(tenant), userId: platformAdmin.id, isAdmin: true, support: true })
    expect(actor.permissions.has('assign-user-roles')).toBe(true)
    const name = `ZZZ ruolo in assistenza ${unique()}`
    await createRole(name)
    expect(await rolesNamed(tenant, name)).toHaveLength(1)
    expect(await rolesNamed(other, name)).toHaveLength(0)

    // Solo quel tenant: il cambio di tenant della sessione non porta altrove (nemmeno in uno che ha concesso il permesso).
    await expect(chooseTenant(Number(other))).rejects.toThrow('tenant_not_available')
    const moved = await updateTokenTenant(platformAdmin.id, mocks.token, hostNow(), { user: { tenantId: Number(other) } })
    expect(moved).toMatchObject({ tenantState: 'support', tenantId: Number(tenant) })

    // Fino alla scadenza: si sposta l'orologio, e la richiesta dopo è fuori, senza autorità.
    await expireConsent(tenant)
    await nextRequest()
    expect(mocks.token).toMatchObject({ tenantState: 'none', tenantId: null, roleIds: [], tenantNoneReason: 'support_ended', isPlatformAdmin: true })
    await expect(requirePermission('manage-roles')).rejects.toThrow('Unauthorized')
    // Alla scadenza naturale non si scrive nulla (MT5-DEC-20): l'ingresso ne riporta già la scadenza.
    const rows = await tenantAuditOf(tenant)
    expect(rows.filter(row => row.operation === 'support.exit')).toEqual([])
    expect(rows.find(row => row.operation === 'support.enter')?.details).toMatchObject({ reason: 'verifica di un menu', until: granted.until })
    // La richiesta dopo ancora ricalcola il token come un accesso: chi non ha tenant torna alla console.
    await nextRequest()
    expect(mocks.token).toMatchObject({ tenantState: 'none', tenantNoneReason: null, isPlatformAdmin: true })
  }, 90_000)

  it('expiry, revocation, suspension or losing the attribute end support at the next request', async () => {
    const tenant = await seedTenant('end')
    const admin = await seedAdmin(tenant, 'end-admin')
    const enter = async (who: Person) => {
      await grantAs(admin)
      await signIn(who)
      expect(await startSupport(Number(tenant), 'motivo')).toEqual({ state: 'support' })
      expect((await nextRequest()).tenantState).toBe('support')
    }
    const expectOut = async () => {
      const token = await nextRequest()
      expect(token).toMatchObject({ tenantState: 'none', tenantId: null, roleIds: [], tenantNoneReason: 'support_ended' })
      await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
    }

    // Scadenza: l'orologio spostato nel database.
    await enter(platformAdmin)
    const stale = { ...mocks.token }
    await expireConsent(tenant)
    await expectOut()

    // Revoca: l'amministratore del tenant revoca mentre la piattaforma lavora.
    await enter(platformAdmin)
    const before = { who: mocks.who, token: mocks.token }
    await signIn(admin)
    expect(await revokeSupportConsent()).toEqual({ ok: true })
    mocks.who = before.who
    mocks.token = before.token
    await expectOut()
    expect((await consentOf(tenant)).until).toBeNull()

    // Sospensione del tenant.
    await enter(platformAdmin)
    await setStatus(tenant, 'suspended')
    await expectOut()
    await setStatus(tenant, 'active')

    // L'attributo tolto: chi non è più amministratore di piattaforma non va nemmeno alla console.
    await enter(otherPlatformAdmin)
    await setPlatformAdmin(otherPlatformAdmin.id, false)
    await expectOut()
    expect(mocks.token.isPlatformAdmin).toBe(false)
    await setPlatformAdmin(otherPlatformAdmin.id, true)

    // Un token di assistenza vecchio (una copia del cookie) non rientra quando il permesso torna valido
    // dopo l'uscita: l'ultima voce di quella persona nel tenant è un'uscita, o un ingresso più recente
    // di un'altra sessione, e in ogni caso il permesso è stato rinnovato da chi lo concede.
    await enter(platformAdmin)
    await endSupport()
    mocks.token = stale
    await expectOut()
  }, 120_000)

  it('support in a dedicated-host tenant works from the main address and is refused from the dedicated host', async () => {
    const dedicated = `zzz-sup-${unique()}.example.test`
    const tenant = await seedTenant('dedicated', { host: dedicated })
    const admin = await seedAdmin(tenant, 'dedicated-admin')
    // L'amministratore del tenant ci lavora dal suo indirizzo, ed è lì che concede il permesso.
    mocks.host = dedicated
    await grantAs(admin)

    // Dall'indirizzo dedicato la console non esiste: la guardia rifiuta e non si scrive niente.
    mocks.host = dedicated
    await signIn(platformAdmin)
    await expect(startSupport(Number(tenant), 'dal dedicato')).rejects.toThrow('Unauthorized')
    expect((await tenantAuditOf(tenant)).filter(row => row.operation === 'support.enter')).toEqual([])
    expect(await platformAuditOf(tenant)).toEqual([])
    const forged = await updateTokenTenant(platformAdmin.id, mocks.token, hostNow(), { user: { supportTenantId: Number(tenant) } })
    expect(forged.tenantState).not.toBe('support')

    // Dall'indirizzo principale sì (MT5-DEC-19).
    mocks.host = MAIN
    await signIn(platformAdmin)
    expect(await startSupport(Number(tenant), 'dal principale')).toEqual({ state: 'support' })
    expect((await nextRequest()).tenantState).toBe('support')

    // Lo stesso token presentato sull'indirizzo dedicato esce dall'assistenza.
    mocks.host = dedicated
    expect(await nextRequest()).toMatchObject({ tenantState: 'none', tenantId: null, tenantNoneReason: 'support_ended', isPlatformAdmin: false })
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
  }, 60_000)

  it('the template is reachable without consent', async () => {
    await withOwner(tx => tx.update(tenantSettings).set({ supportUntil: null }), templateId)
    await signIn(platformAdmin)
    expect(await startSupport(Number(templateId), 'modifica del modello')).toEqual({ state: 'support' })
    expect(mocks.token).toMatchObject({ tenantState: 'support', tenantId: Number(templateId), supportUntil: null })
    await nextRequest()
    expect(mocks.token).toMatchObject({ tenantState: 'support', tenantId: Number(templateId) })
    expect(await requirePermission('manage-roles')).toMatchObject({ tenantId: Number(templateId), support: true })

    // Sempre con il registro: ingresso e uscita nei due registri, con la veste della piattaforma.
    expect(await endSupport()).toMatchObject({ state: 'none' })
    const tenantRows = (await tenantAuditOf(templateId)).filter(row => row.id > defaultTemplateAuditMax && row.actor_user_id === platformAdmin.id)
    expect(tenantRows.map(row => row.operation)).toEqual(['support.enter', 'support.exit'])
    expect(tenantRows.every(row => row.actor_kind === 'platform')).toBe(true)
    expect((await platformAuditOf(templateId)).filter(row => row.actor_user_id === platformAdmin.id).map(row => row.operation))
      .toEqual(['support.enter', 'support.exit'])
  }, 60_000)

  it('changes during support are written in the tenant audit with actor_kind platform', async () => {
    const tenant = await seedTenant('audit')
    const admin = await seedAdmin(tenant, 'audit-admin')
    const granted = await grantAs(admin, '1h')

    await signIn(platformAdmin)
    await startSupport(Number(tenant), 'correzione dei ruoli')
    await nextRequest()
    const name = `ZZZ ruolo della piattaforma ${unique()}`
    const { id } = await createRole(name)
    expect(await endSupport()).toMatchObject({ state: 'none' })
    expect(mocks.token).toMatchObject({ tenantState: 'none', tenantNoneReason: null, isPlatformAdmin: true })

    const tenantRows = await tenantAuditOf(tenant)
    expect(tenantRows.map(row => row.operation)).toEqual(['support.grant', 'support.enter', 'role.create', 'support.exit'])
    expect(tenantRows[0]).toMatchObject({ actor_kind: 'person', actor_user_id: admin.id, details: { duration: '1h', until: granted.until } })
    for (const row of tenantRows.slice(1)) {
      expect(row).toMatchObject({ actor_kind: 'platform', actor_user_id: platformAdmin.id, actor_email: platformAdmin.email })
    }
    expect(tenantRows[2]).toMatchObject({ object_type: 'role', object_id: String(id) })
    expect(tenantRows[1].details).toMatchObject({ reason: 'correzione dei ruoli', until: granted.until })

    // Nel registro della piattaforma solo ingresso e uscita (MT5-DEC-16, MT5-DEC-20), non la modifica.
    const platformRows = await platformAuditOf(tenant)
    expect(platformRows.map(row => row.operation)).toEqual(['support.enter', 'support.exit'])
    expect(platformRows.every(row => row.actor_kind === 'platform' && row.actor_user_id === platformAdmin.id)).toBe(true)

    // Dopo l'uscita la richiesta dopo è fuori dal tenant.
    await nextRequest()
    expect(mocks.token.tenantState).not.toBe('support')
  }, 60_000)

  it('during support the consent actions are refused', async () => {
    const tenant = await seedTenant('locked')
    const admin = await seedAdmin(tenant, 'locked-admin')
    const granted = await grantAs(admin, '1h')
    await signIn(platformAdmin)
    await startSupport(Number(tenant), 'impostazioni')
    await nextRequest()
    const before = await tenantAuditOf(tenant)

    // Ha i permessi di un amministratore, compreso manage-tenant-settings (registrazioni autonome)…
    expect((await requirePermission('manage-tenant-settings')).support).toBe(true)
    // …ma non concede, non allunga e non revoca il permesso di assistenza (MT5-DEC-12).
    await expect(grantSupportConsent('1w')).rejects.toThrow('Unauthorized')
    await expect(revokeSupportConsent()).rejects.toThrow('Unauthorized')
    expect(await tenantAuditOf(tenant)).toEqual(before)
    expect(Date.parse((await consentOf(tenant)).until!)).toBe(Date.parse(granted.until))
    expect((await nextRequest()).tenantState).toBe('support')
  }, 60_000)

  it('the token enters support only right after the action wrote its entry', async () => {
    const tenant = await seedTenant('window')
    const admin = await seedAdmin(tenant, 'window-admin')
    await grantAs(admin)
    await signIn(platformAdmin)
    const outside = { ...mocks.token }
    await startSupport(Number(tenant), 'finestra')
    await endSupport()
    // L'ultima voce è un'uscita: un aggiornamento che chiede l'ingresso non basta.
    mocks.token = { ...outside }
    expect((await updateTokenTenant(platformAdmin.id, mocks.token, hostNow(), { user: { supportTenantId: Number(tenant) } })).tenantState).not.toBe('support')

    // Un ingresso di qualche minuto fa non apre una sessione nuova: la voce è vecchia.
    await startSupport(Number(tenant), 'finestra 2')
    await withOwner(tx => tx.execute(sql`update public.tenant_audit_event set occurred_at = now() - interval '10 minutes'
      where operation = 'support.enter'`), tenant)
    mocks.token = { ...outside }
    expect((await updateTokenTenant(platformAdmin.id, mocks.token, hostNow(), { user: { supportTenantId: Number(tenant) } })).tenantState).not.toBe('support')
  }, 60_000)

  // Fix round 1: una voce d'ingresso vale solo per il permesso in corso. Revoca, scadenza e cambi di
  // stato del tenant la chiudono anche se nessuna richiesta è passata nel frattempo, e un permesso
  // nuovo non riapre un token rimasto fermo: la piattaforma rientra e scrive un ingresso nuovo.
  describe('a dormant support token does not resume under a later grant', () => {
    async function enterAndPark(label: string) {
      const tenant = await seedTenant(label)
      const admin = await seedAdmin(tenant, `${label}-admin`)
      await grantAs(admin)
      await signIn(platformAdmin)
      expect(await startSupport(Number(tenant), 'sessione dimenticata')).toEqual({ state: 'support' })
      expect((await nextRequest()).tenantState).toBe('support')
      expect(await withTenant(tenant, tx => readSupportInProgress(tx))).toBe(true)
      // Il cookie resta fermo: nessuna richiesta fino alla fine.
      return { tenant, admin, parked: { ...mocks.token } }
    }
    async function wakeUp(parked: Record<string, unknown>, tenant: TenantId) {
      mocks.who = platformAdmin
      mocks.token = { ...parked }
      expect(await nextRequest()).toMatchObject({ tenantState: 'none', tenantId: null, tenantNoneReason: 'support_ended' })
      await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
      // Le impostazioni del tenant e la porta dicono la stessa cosa: nessuna assistenza in corso.
      expect(await withTenant(tenant, tx => readSupportInProgress(tx))).toBe(false)
    }

    it('revoke, then a new grant', async () => {
      const { tenant, admin, parked } = await enterAndPark('dormant-revoke')
      await signIn(admin)
      expect(await revokeSupportConsent()).toEqual({ ok: true })
      await grantAs(admin, '1w')
      await wakeUp(parked, tenant)
    }, 60_000)

    it('natural expiry, then a new grant', async () => {
      const { tenant, admin, parked } = await enterAndPark('dormant-expiry')
      await expireConsent(tenant)
      await grantAs(admin, '1w')
      await wakeUp(parked, tenant)
    }, 60_000)

    it('suspension and reactivation, with the consent still valid and with a new grant', async () => {
      const first = await enterAndPark('dormant-suspend')
      await setPlatformTenantStatus(first.tenant, 'suspended')
      await setPlatformTenantStatus(first.tenant, 'active')
      await wakeUp(first.parked, first.tenant)

      const second = await enterAndPark('dormant-suspend-grant')
      await setPlatformTenantStatus(second.tenant, 'suspended')
      await setPlatformTenantStatus(second.tenant, 'active')
      await grantAs(second.admin, '1w')
      await wakeUp(second.parked, second.tenant)
    }, 90_000)

    it('extending the consent during support ends support at the next request; entering again works', async () => {
      const { tenant, admin } = await enterAndPark('extend')
      const live = { ...mocks.token }
      await grantAs(admin, '1w')
      mocks.token = live
      expect(await nextRequest()).toMatchObject({ tenantState: 'none', tenantNoneReason: 'support_ended' })
      // Un ingresso nuovo, sotto il permesso nuovo, con la sua voce.
      await nextRequest()
      expect(await startSupport(Number(tenant), 'di nuovo')).toEqual({ state: 'support' })
      expect(await nextRequest()).toMatchObject({ tenantState: 'support', supportReason: 'di nuovo' })
    }, 60_000)
  })

  // Fix round 1: in assistenza la piattaforma non si dà un accesso che sopravviva al permesso.
  it('during support the platform admin cannot add, invite or change its own account in the tenant', async () => {
    const tenant = await seedTenant('self')
    const admin = await seedAdmin(tenant, 'self-admin')
    const colleague = await createAccount('self-colleague')
    await addMember(tenant, colleague)
    // La seconda amministratrice di piattaforma è anche membro semplice del tenant.
    await addMember(tenant, otherPlatformAdmin)
    await grantAs(admin)
    const system = await withTenant(tenant, tx => getSystemRoleIds(tx))
    const before = await tenantAuditOf(tenant)

    for (const who of [platformAdmin, otherPlatformAdmin]) {
      await signIn(who)
      expect(await startSupport(Number(tenant), 'controllo')).toEqual({ state: 'support' })
      await nextRequest()
      await expect(addUserByEmail(who.email)).rejects.toThrow()
      await expect(updateUserRoles(who.id, [system.tenantAdmin])).rejects.toThrow()
      await expect(setUserStatus(who.id, 2)).rejects.toThrow()
      const invite = await sendInvite(new NextRequest('http://localhost:3000/api/admin/send-invite', {
        method: 'POST', body: JSON.stringify({ userId: who.id }), headers: { 'content-type': 'application/json' },
      }))
      expect(invite.status).toBe(403)
      await endSupport()
    }
    // Né appartenenze né ruoli nuovi per le due persone della piattaforma, e nessuna voce oltre ingressi e uscite.
    const memberships = await withOwner(tx => tx.select({ userId: tenantMembership.userId }).from(tenantMembership)
      .where(inArray(tenantMembership.userId, [platformAdmin.id, otherPlatformAdmin.id])), tenant)
    expect(memberships.map(row => row.userId)).toEqual([otherPlatformAdmin.id])
    const roles = await withOwner(tx => tx.select({ idRole: userRole.idRole }).from(userRole)
      .where(eq(userRole.userId, otherPlatformAdmin.id)), tenant)
    expect(roles.map(row => row.idRole)).toEqual([system.registered])
    expect((await tenantAuditOf(tenant)).slice(before.length).map(row => row.operation))
      .toEqual(['support.enter', 'support.exit', 'support.enter', 'support.exit'])

    // Sulle altre persone, invece, ha i permessi di un amministratore (MT5-DEC-12).
    await signIn(platformAdmin)
    await startSupport(Number(tenant), 'ruoli')
    await nextRequest()
    await updateUserRoles(colleague.id, [system.tenantAdmin])
    const colleagueRoles = await withOwner(tx => tx.select({ idRole: userRole.idRole }).from(userRole)
      .where(eq(userRole.userId, colleague.id)), tenant)
    expect(colleagueRoles.map(row => row.idRole).sort()).toEqual([system.registered, system.tenantAdmin].sort())
  }, 90_000)
})
