import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { inArray, like, sql } from 'drizzle-orm'
import { POST as platformAuditGrid } from '@/app/api/platform/audit-grid/route'
import { POST as tenantAuditGrid } from '@/app/api/audit/tenant-grid/route'
import TenantAuditPage from '@/app/(protected)/(admin)/admin/audit/page'
import PlatformAuditPage from '@/app/platform/audit/page'
import { platformAuditEvent, tenantAuditEvent, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { listTenantAudit } from '@/lib/audit/audit-read-service'
import { listPlatformAudit, listTemplateAudit } from './audit-service'
import { closePlatform, withPlatform } from './db'

/**
 * Le due viste del registro contro il database vero (specifica 2026-10-26, MT5-DEC-16, MT5-DEC-21,
 * MT5-OK-4). L'amministratore di un tenant vede le voci del suo tenant, quelle della piattaforma in
 * assistenza comprese, e mai quelle di un altro tenant. La console vede solo il registro della
 * piattaforma, e del modello quello di tenant: mai le voci degli altri tenant. Guardie, servizi,
 * rotte e database sono veri; finti solo i confini di Next e di Auth.js e i componenti client.
 */
const mocks = vi.hoisted(() => ({ session: null as unknown, headers: new Headers() }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({
  headers: async () => mocks.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/components/audit/AuditTableClient', () => ({ AuditTableClient: () => null }))
vi.mock('./db', async importOriginal => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})

const MAIN_HOST = 'construct.example.test'
const RUN = `zzzaudit${unique()}`
const MARK_A = `${RUN}a`
const MARK_B = `${RUN}b`
const MARK_PLATFORM = `${RUN}p`
const MARK_TEMPLATE = `${RUN}t`

type Person = { id: string; email: string }

let A: TenantId
let B: TenantId
let template: TenantId
let adminA: Person
let memberA: Person
let platformAdmin: Person
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

async function createTenant(label: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-audit-${label}-${unique()}`.slice(0, 40)}, ${`ZZZ ${label}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function createUser(label: string, platform = false): Promise<Person> {
  const email = `zzz_audit_${label}_${unique()}@example.test`
  const [row] = await withOwner(tx => tx.insert(users)
    .values({ email, idUserStatus: 2, authProvider: 'credentials', isPlatformAdmin: platform })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function addMember(tenantId: TenantId, who: Person, admin: boolean): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: who.id, status: 'active' })
    await tx.insert(userRole).values({ userId: who.id, idRole: system.registered })
    if (admin) await tx.insert(userRole).values({ userId: who.id, idRole: system.tenantAdmin })
  })
}

function readySession(who: Person, tenantId: TenantId) {
  return {
    user: { id: who.id, email: who.email, accountActive: true, provider: 'credentials', tenantState: 'ready', tenantId: Number(tenantId), tenantName: 'ZZZ' },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function platformSession(who: Person) {
  return {
    user: { id: who.id, email: who.email, accountActive: true, tenantState: 'none', tenantId: null, isPlatformAdmin: true },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function gridRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

const ALL = { page: 0, size: 200 }

async function insertTenantRow(tenantId: TenantId, values: { actorKind: string; actorEmail: string; operation: string; objectId: string; details?: Record<string, unknown>; occurredAt?: string }): Promise<void> {
  await withOwner(tx => tx.insert(tenantAuditEvent).values({ objectType: 'role', ...values }), tenantId)
}

beforeAll(async () => {
  const [found] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
  if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
  template = tenantIdForTest(Number(found.id))
  A = await createTenant('a')
  B = await createTenant('b')
  adminA = await createUser('admin')
  memberA = await createUser('member')
  platformAdmin = await createUser('platform', true)
  await addMember(A, adminA, true)
  await addMember(A, memberA, false)

  // Voci di A: una di una persona, una della piattaforma in assistenza (veste `platform`), una vecchia
  // e una con un segreto sotto un nome vietato (scritta fuori dal percorso normale, che lo toglie).
  await insertTenantRow(A, { actorKind: 'person', actorEmail: `zzz_${MARK_A}_one@example.test`, operation: 'role.create', objectId: `${MARK_A}1`, details: { name: 'uno' } })
  await insertTenantRow(A, { actorKind: 'platform', actorEmail: `zzz_${MARK_A}_support@example.test`, operation: 'menu.update', objectId: `${MARK_A}2`, details: { during: 'support' } })
  await insertTenantRow(A, { actorKind: 'person', actorEmail: `zzz_${MARK_A}_old@example.test`, operation: 'role.delete', objectId: `${MARK_A}3`, occurredAt: '2020-01-15T10:00:00Z' })
  await insertTenantRow(A, {
    actorKind: 'person', actorEmail: `zzz_${MARK_A}_secret@example.test`, operation: 'member.invite', objectId: `${MARK_A}4`,
    details: { email: 'x@example.test', inviteLink: 'https://secret.example/set?token=abc', nested: { password: 'p', keep: 1 } },
  })
  // B, il modello e la piattaforma: ognuno con il suo segno.
  await insertTenantRow(B, { actorKind: 'person', actorEmail: `zzz_${MARK_B}@example.test`, operation: 'role.create', objectId: `${MARK_B}1`, details: { name: MARK_B } })
  await insertTenantRow(B, { actorKind: 'platform', actorEmail: `zzz_${MARK_B}_support@example.test`, operation: 'menu.update', objectId: `${MARK_B}2` })
  await insertTenantRow(template, { actorKind: 'platform', actorEmail: `zzz_${MARK_TEMPLATE}@example.test`, operation: 'menu.create', objectId: `${MARK_TEMPLATE}1`, details: { name: MARK_TEMPLATE } })
  await withOwner(tx => tx.insert(platformAuditEvent).values([
    { actorKind: 'platform', actorEmail: `zzz_${MARK_PLATFORM}@example.test`, operation: 'tenant.create', objectType: 'tenant', objectId: `${MARK_PLATFORM}1`, idTenant: B, details: { name: MARK_PLATFORM } },
    { actorKind: 'platform', actorEmail: `zzz_${MARK_PLATFORM}@example.test`, operation: 'language.create', objectType: 'language', objectId: `${MARK_PLATFORM}2` },
  ]))
}, 90_000)

afterAll(async () => {
  const errors: unknown[] = []
  const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
  await step(() => withOwner(tx => tx.delete(platformAuditEvent).where(like(platformAuditEvent.objectId, `${RUN}%`))))
  await step(() => withOwner(tx => tx.delete(tenantAuditEvent).where(like(tenantAuditEvent.objectId, `${RUN}%`)), template))
  for (const id of createdTenants) await step(() => deleteTenantForTest(id))
  await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
  await step(() => closePlatform())
  await step(() => closeOwner())
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => {
  mocks.session = readySession(adminA, A)
  mocks.headers = new Headers({ host: MAIN_HOST })
  vi.mocked(withPlatform).mockClear()
})

describeIntegration('the tenant audit view', () => {
  it('the admin of A sees A audit rows including platform support rows, never B rows', async () => {
    const { rows, total } = await listTenantAudit(A, { ...ALL, direction: 'ASC' })
    const objectIds = rows.map(row => row.objectId)
    expect(objectIds).toEqual(expect.arrayContaining([`${MARK_A}1`, `${MARK_A}2`, `${MARK_A}3`, `${MARK_A}4`]))
    expect(total).toBe(rows.length)
    // La voce che la piattaforma ha scritto in assistenza è lì, con la sua veste.
    expect(rows.find(row => row.objectId === `${MARK_A}2`)).toMatchObject({ actorKind: 'platform', operation: 'menu.update' })
    // Nessuna voce di B, del modello o della piattaforma.
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(MARK_B)
    expect(serialized).not.toContain(MARK_TEMPLATE)
    expect(serialized).not.toContain(MARK_PLATFORM)

    // Anche dalla rotta, e anche cercando il segno di B.
    const viaRoute = await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', ALL))
    expect(viaRoute.status).toBe(200)
    expect(JSON.stringify(await viaRoute.json())).not.toContain(MARK_B)
    const searched = await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { ...ALL, actorSearch: MARK_B }))
    expect(await searched.json()).toEqual({ rows: [], total: 0 })
  })

  it('refuses a tenant id that is not the tenant of the signed-in admin', async () => {
    await expect(listTenantAudit(B, ALL)).rejects.toThrow('Unauthorized')
  })

  it('refuses a member without the permission, in the service, the route and the page', async () => {
    mocks.session = readySession(memberA, A)
    await expect(listTenantAudit(A, ALL)).rejects.toThrow('Unauthorized')
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', ALL))).status).toBe(403)
    await expect(TenantAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/')
    mocks.session = null
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', ALL))).status).toBe(403)
  })

  it('filters by person, operation and period, and sorts only by the listed columns', async () => {
    const byPerson = await listTenantAudit(A, { ...ALL, actorSearch: `${MARK_A}_support` })
    expect(byPerson.rows.map(row => row.objectId)).toEqual([`${MARK_A}2`])

    const byOperation = await listTenantAudit(A, { ...ALL, operation: 'role.delete' })
    expect(byOperation.rows.map(row => row.objectId)).toEqual([`${MARK_A}3`])

    const old = await listTenantAudit(A, { ...ALL, from: '2020-01-15', to: '2020-01-15' })
    expect(old.rows.map(row => row.objectId)).toEqual([`${MARK_A}3`])
    const recent = await listTenantAudit(A, { ...ALL, from: '2021-01-01' })
    expect(recent.rows.map(row => row.objectId)).not.toContain(`${MARK_A}3`)
    expect(recent.rows.length).toBeGreaterThanOrEqual(3)

    // Il più recente prima, di norma; l'altro verso a richiesta.
    const newestFirst = await listTenantAudit(A, { ...ALL, actorSearch: MARK_A })
    expect(newestFirst.rows.at(-1)?.objectId).toBe(`${MARK_A}3`)
    const oldestFirst = await listTenantAudit(A, { ...ALL, actorSearch: MARK_A, sort: 'occurredAt', direction: 'ASC' })
    expect(oldestFirst.rows[0].objectId).toBe(`${MARK_A}3`)
    const byActor = await listTenantAudit(A, { ...ALL, actorSearch: MARK_A, sort: 'actor', direction: 'ASC' })
    expect(byActor.rows.map(row => row.actorEmail)).toEqual([...byActor.rows.map(row => row.actorEmail)].sort())

    // Una pagina di una riga, e il totale intero.
    const page = await listTenantAudit(A, { page: 1, size: 1, actorSearch: MARK_A, sort: 'occurredAt', direction: 'ASC' })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(4)
  })

  it('treats the search text as text, not as SQL or as a pattern', async () => {
    // I caratteri del LIKE valgono come lettere: `%` e `\\` non compaiono in nessuna email, e `z_z` non è «zzz».
    for (const hostile of ["'; drop table tenant_audit_event; --", '%', 'e_a', '\\']) {
      const result = await listTenantAudit(A, { ...ALL, actorSearch: hostile })
      expect(result.rows).toEqual([])
    }
    expect((await listTenantAudit(A, ALL)).rows.length).toBeGreaterThanOrEqual(4)
  })

  it('shows details without anything that looks like a password, token or link, even in a row written elsewhere', async () => {
    const { rows } = await listTenantAudit(A, { ...ALL, operation: 'member.invite' })
    const row = rows.find(entry => entry.objectId === `${MARK_A}4`)!
    expect(row.details).toEqual({ email: 'x@example.test', nested: { keep: 1 } })
  })

  it('answers the route with 400 to a body that is not a valid query, after checking who asks', async () => {
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { page: 0, size: 5000 }))).status).toBe(400)
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { ...ALL, operation: 'drop.table' }))).status).toBe(400)
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { ...ALL, sort: 'id_tenant' }))).status).toBe(400)
    expect((await tenantAuditGrid(gridRequest('/api/audit/tenant-grid', { ...ALL, from: '2026-07-30', to: '2026-07-01' }))).status).toBe(400)
  })

  it('opens the page for the admin', async () => {
    await expect(TenantAuditPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
  })
})

describeIntegration('the platform audit view', () => {
  beforeEach(() => { mocks.session = platformSession(platformAdmin) })

  it('the platform audit page never returns tenant audit rows except the template', async () => {
    const platform = await listPlatformAudit({ ...ALL, actorSearch: `zzz_${RUN}` })
    expect(platform.rows.map(row => row.objectId).sort()).toEqual([`${MARK_PLATFORM}1`, `${MARK_PLATFORM}2`])
    const serialized = JSON.stringify(platform)
    // Nemmeno una voce di tenant: né di A, né di B, né del modello.
    expect(serialized).not.toContain(MARK_A)
    expect(serialized).not.toContain(`zzz_${MARK_B}`)
    expect(serialized).not.toContain(MARK_TEMPLATE)
    // Il tenant toccato si legge con il nome.
    expect(platform.rows.find(row => row.objectId === `${MARK_PLATFORM}1`)).toMatchObject({ tenantId: B, tenantName: 'ZZZ b' })
    expect(platform.rows.find(row => row.objectId === `${MARK_PLATFORM}2`)).toMatchObject({ tenantId: null, tenantName: null })

    // Senza filtri, sull'intero registro: ogni riga è una voce della piattaforma.
    const everything = await listPlatformAudit(ALL)
    for (const row of everything.rows) expect(row.objectId ?? '').not.toMatch(new RegExp(`${MARK_A}|${MARK_B}1|${MARK_B}2|${MARK_TEMPLATE}`))

    // Dalla rotta lo stesso, con e senza il campo `scope` che ha un valore solo per il modello.
    const viaRoute = await platformAuditGrid(gridRequest('/api/platform/audit-grid', { ...ALL, actorSearch: `zzz_${RUN}` }))
    expect(viaRoute.status).toBe(200)
    expect(JSON.stringify(await viaRoute.json())).not.toContain(MARK_TEMPLATE)
  })

  it('shows the audit of the template, and only the template, in its own listing', async () => {
    const result = await listTemplateAudit({ ...ALL, actorSearch: `zzz_${RUN}` })
    expect(result.rows.map(row => row.objectId)).toEqual([`${MARK_TEMPLATE}1`])
    const everything = await listTemplateAudit(ALL)
    const serialized = JSON.stringify(everything)
    expect(serialized).not.toContain(MARK_A)
    expect(serialized).not.toContain(MARK_B)
    expect(serialized).not.toContain(MARK_PLATFORM)

    const viaRoute = await platformAuditGrid(gridRequest('/api/platform/audit-grid', { ...ALL, scope: 'template', actorSearch: `zzz_${RUN}` }))
    const body = await viaRoute.json() as { rows: { objectId: string }[] }
    expect(body.rows.map(row => row.objectId)).toEqual([`${MARK_TEMPLATE}1`])
  })

  it('filters by person, operation and period', async () => {
    const byOperation = await listPlatformAudit({ ...ALL, operation: 'language.create', actorSearch: `zzz_${RUN}` })
    expect(byOperation.rows.map(row => row.objectId)).toEqual([`${MARK_PLATFORM}2`])
    const farPast = await listPlatformAudit({ ...ALL, to: '2000-01-01' })
    expect(farPast.rows).toEqual([])
    const today = new Date().toISOString().slice(0, 10)
    const fromToday = await listPlatformAudit({ ...ALL, from: today, actorSearch: `zzz_${RUN}` })
    expect(fromToday.rows).toHaveLength(2)
  })

  it('refuses everyone who is not a platform admin, before opening the platform identity', async () => {
    for (const session of [readySession(adminA, A), null]) {
      mocks.session = session
      await expect(listPlatformAudit(ALL)).rejects.toThrow('Unauthorized')
      await expect(listTemplateAudit(ALL)).rejects.toThrow('Unauthorized')
      expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', ALL))).status).toBe(403)
      await expect(PlatformAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    }
    // Il flag nel token non basta: l'attributo si rilegge dal database.
    mocks.session = { ...readySession(adminA, A), user: { ...readySession(adminA, A).user, isPlatformAdmin: true } }
    await expect(listPlatformAudit(ALL)).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('answers 404 on a dedicated address and 400 to an invalid body', async () => {
    expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', { page: 0, size: 5000 }))).status).toBe(400)
    expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', { ...ALL, scope: 'tenant' }))).status).toBe(400)
    const dedicated = `zzz-audit-${unique()}.example.test`
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${dedicated}, ${A}, true)`))
    mocks.headers = new Headers({ host: dedicated })
    expect((await platformAuditGrid(gridRequest('/api/platform/audit-grid', ALL))).status).toBe(404)
  })

  it('opens the page for the platform admin', async () => {
    await expect(PlatformAuditPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
  })
})
