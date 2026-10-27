import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { menuEntry, role, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform, withPlatform } from '@/lib/platform/db'
import { listTenantsForPlatform } from './tenant-service'
import type { PlatformTenantRow, PlatformTenantsQuery } from './tenants-grid-query'

/**
 * L'elenco dei tenant della console contro il database vero (specifica 2026-10-26, MT5-DEC-4,
 * MT5-OK-2). Finti sono solo i confini di Next (sessione e intestazioni). La guardia è quella vera:
 * il servizio verifica l'amministratore di piattaforma prima di aprire la transazione con l'identità
 * di piattaforma, e da lì legge solo numeri e email degli amministratori, mai righe dei tenant.
 */
const mocks = vi.hoisted(() => ({ session: null as unknown, headers: new Headers() }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
// La porta vera, ma osservabile: un rifiuto non deve nemmeno aprirla.
vi.mock('@/lib/platform/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/platform/db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})

const MAIN_HOST = 'construct.example.test'
const MARK = `zzzmark${unique()}`
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
const PAGE = { page: 0, size: 200 } satisfies Pick<PlatformTenantsQuery, 'page' | 'size'>

type Person = { id: string; email: string }
let platformAdmin: Person
let A: TenantId
let hostA: string
let adminOne: Person
let adminTwo: Person
let plainMember: Person
let archived: TenantId
let suspended: TenantId

function sessionOf(who: Person) {
  return {
    user: { id: who.id, email: who.email, accountActive: true, tenantState: 'none', tenantId: null, isPlatformAdmin: true },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

async function createUser(label: string, options: { platformAdmin?: boolean; status?: number; firstName?: string } = {}): Promise<Person> {
  const email = `zzz_tenants_${label}_${unique()}@example.test`
  // Il flag lo scrive solo il proprietario (un trigger lo nega al ruolo dell'app).
  const [row] = await withOwner(tx => tx.insert(users)
    .values({ email, idUserStatus: options.status ?? 2, authProvider: 'credentials', isPlatformAdmin: options.platformAdmin ?? false, firstName: options.firstName })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function createTenant(label: string, status: 'active' | 'suspended' | 'archived' = 'active'): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-tenants-${unique()}`.slice(0, 40)}, ${`ZZZ ${label} ${unique()}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  if (status !== 'active') await withOwner(tx => tx.execute(sql`update public.tenant set status = ${status} where id = ${id}`))
  return id
}

async function addMember(tenantId: TenantId, who: Person, options: { admin?: boolean; membership?: 'active' | 'deactivated' } = {}): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: who.id, status: options.membership ?? 'active' })
    await tx.insert(userRole).values({ userId: who.id, idRole: system.registered })
    if (options.admin) await tx.insert(userRole).values({ userId: who.id, idRole: system.tenantAdmin })
  })
}

const rowOf = (rows: PlatformTenantRow[], id: TenantId) => rows.find(row => row.id === Number(id))

beforeAll(async () => {
  platformAdmin = await createUser('padmin', { platformAdmin: true })

  A = await createTenant('Acme')
  hostA = `zzz-tenants-${unique()}.example.test`
  await withOwner(async tx => {
    await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${hostA}, ${A}, true)`)
    await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${`secondary-${hostA}`}, ${A}, false)`)
  })
  adminOne = await createUser('a1', { firstName: MARK })
  adminTwo = await createUser('a2')
  plainMember = await createUser('plain')
  const deactivatedMember = await createUser('offmember')
  const deactivatedAccount = await createUser('offaccount', { status: 1 })
  const deactivatedAdmin = await createUser('offadmin')
  await addMember(A, adminOne, { admin: true })
  await addMember(A, adminTwo, { admin: true })
  await addMember(A, plainMember)
  await addMember(A, deactivatedMember, { membership: 'deactivated' })
  await addMember(A, deactivatedAccount)
  await addMember(A, deactivatedAdmin, { admin: true, membership: 'deactivated' })

  // Dati interni del tenant che l'elenco non deve mai mostrare.
  await withTenant(A, async tx => {
    await tx.insert(role).values({ description: `${MARK} role`, idRoleType: 2 })
    await tx.insert(menuEntry).values({ name: `${MARK} menu` })
  })

  archived = await createTenant('Archiviato', 'archived')
  suspended = await createTenant('Sospeso', 'suspended')
}, 90_000)

afterAll(async () => {
  const errors: unknown[] = []
  for (const id of createdTenants) {
    try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
  }
  try { await withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))) } catch (error) { errors.push(error) }
  try { await closePlatform() } catch (error) { errors.push(error) }
  try { await closeOwner() } catch (error) { errors.push(error) }
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => {
  mocks.session = sessionOf(platformAdmin)
  mocks.headers = new Headers({ host: MAIN_HOST })
  vi.mocked(withPlatform).mockClear()
})

describeIntegration('listTenantsForPlatform', () => {
  it('puts the template first, marked, whatever the sort', async () => {
    for (const direction of ['ASC', 'DESC'] as const) {
      const { rows } = await listTenantsForPlatform({ ...PAGE, sort: 'name', direction })
      expect(rows[0]).toMatchObject({ isTemplate: true, slug: 'template' })
      expect(rows.filter(row => row.isTemplate)).toHaveLength(1)
    }
  })

  it('counts the active people and lists the administrators of every tenant', async () => {
    const { rows } = await listTenantsForPlatform(PAGE)
    const acme = rowOf(rows, A)!
    // Attivi: i due amministratori e il membro. Fuori: appartenenza disattivata, account disattivato.
    expect(acme.activeMembers).toBe(3)
    expect(acme.adminEmails).toEqual([adminOne.email, adminTwo.email].sort())
    // Un amministratore con appartenenza disattivata non è un amministratore attivo.
    expect(acme.adminEmails).toHaveLength(2)
    expect(rowOf(rows, tenantIdForTest(Number(suspended)))!.activeMembers).toBe(0)
    expect(rowOf(rows, tenantIdForTest(Number(suspended)))!.adminEmails).toEqual([])
    // Il modello non ha persone.
    expect(rows.find(row => row.isTemplate)).toMatchObject({ activeMembers: 0, adminEmails: [] })
  })

  it('shows the primary address, and none for a tenant without a dedicated one', async () => {
    const { rows } = await listTenantsForPlatform(PAGE)
    expect(rowOf(rows, A)!.primaryHost).toBe(hostA)
    expect(rowOf(rows, suspended)!.primaryHost).toBeNull()
  })

  it('returns only the documented fields, as numbers, emails and plain values', async () => {
    const result = await listTenantsForPlatform(PAGE)
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'activeMembers', 'adminEmails', 'createdAt', 'id', 'isTemplate', 'name', 'primaryHost', 'slug', 'status',
      ])
      expect(typeof row.createdAt).toBe('string')
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false)
    }
  })

  it('shows nothing from inside a tenant: no role, menu, person name or non-admin email', async () => {
    const serialized = JSON.stringify(await listTenantsForPlatform(PAGE))
    expect(serialized).not.toContain(MARK)
    expect(serialized).not.toContain(plainMember.email)
    // Gli amministratori sì (MT5-OK-2): numeri ed email, e solo quelli.
    expect(serialized).toContain(adminOne.email)
  })

  it('leaves archived tenants out unless the status filter asks for them', async () => {
    const byDefault = (await listTenantsForPlatform(PAGE)).rows
    expect(rowOf(byDefault, archived)).toBeUndefined()
    expect(rowOf(byDefault, suspended)).toMatchObject({ status: 'suspended' })
    expect(rowOf(byDefault, A)).toMatchObject({ status: 'active' })

    const onlyArchived = (await listTenantsForPlatform({ ...PAGE, status: 'archived' })).rows
    expect(onlyArchived.every(row => row.status === 'archived')).toBe(true)
    expect(rowOf(onlyArchived, archived)).toMatchObject({ status: 'archived' })

    const onlySuspended = (await listTenantsForPlatform({ ...PAGE, status: 'suspended' })).rows
    expect(onlySuspended.every(row => row.status === 'suspended')).toBe(true)
    expect(rowOf(onlySuspended, suspended)).toBeDefined()
  })

  it('filters by name, slug and address, case-insensitively and literally', async () => {
    const byName = (await listTenantsForPlatform({ ...PAGE, nameSearch: 'zzz acme' })).rows
    expect(byName.map(row => row.id)).toEqual([Number(A)])
    const bySlug = (await listTenantsForPlatform({ ...PAGE, slugSearch: rowOf((await listTenantsForPlatform(PAGE)).rows, A)!.slug.toUpperCase() })).rows
    expect(bySlug.map(row => row.id)).toEqual([Number(A)])
    const byHost = (await listTenantsForPlatform({ ...PAGE, hostSearch: hostA })).rows
    expect(byHost.map(row => row.id)).toEqual([Number(A)])
    // Il carattere jolly è un carattere: nessun tenant si chiama «%».
    expect((await listTenantsForPlatform({ ...PAGE, nameSearch: '%' })).rows).toEqual([])
    // Due condizioni in OR.
    const either = (await listTenantsForPlatform({ ...PAGE, nameSearch: { operator: 'OR', conditions: ['zzz acme', 'zzz sospeso'] } })).rows
    expect(either.map(row => row.id).sort()).toEqual([Number(A), Number(suspended)].sort())
  })

  it('pages, counts the total and sorts by creation date', async () => {
    const everything = await listTenantsForPlatform(PAGE)
    const first = await listTenantsForPlatform({ page: 0, size: 2, sort: 'createdAt', direction: 'DESC' })
    expect(first.rows).toHaveLength(2)
    expect(first.total).toBe(everything.total)
    const second = await listTenantsForPlatform({ page: 1, size: 2, sort: 'createdAt', direction: 'DESC' })
    expect(second.rows.map(row => row.id)).not.toEqual(first.rows.map(row => row.id))
    // Il modello resta in cima a ogni pagina d'inizio, poi dal più recente.
    expect(first.rows[0].isTemplate).toBe(true)
    // Un periodo che non contiene niente.
    expect((await listTenantsForPlatform({ ...PAGE, createdTo: '2000-01-01' })).rows).toEqual([])
  })

  it('puts app.tenant_id back after counting, with or without a tenant set', async () => {
    const read = (tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }) =>
      tx.execute(sql`select current_setting('app.tenant_id', true) as v`) as Promise<{ v: string | null }[]>
    const withTenantSet = await withPlatform(async tx => {
      await tx.execute(sql`select * from app_private.platform_tenant_counts(array[${Number(A)}::bigint, ${Number(suspended)}::bigint])`)
      return (await read(tx))[0].v
    }, A)
    expect(withTenantSet).toBe(String(A))
    const withoutTenant = await withPlatform(async tx => {
      await tx.execute(sql`select * from app_private.platform_tenant_counts(array[${Number(A)}::bigint])`)
      return (await read(tx))[0].v
    })
    expect(withoutTenant === null || withoutTenant === '').toBe(true)
  })

  it('the counting function is not reachable from the app role', async () => {
    await expect(withGlobal(tx => tx.execute(sql`select * from app_private.platform_tenant_counts(array[1]::bigint[])`))).rejects.toThrow()
  })

  it.each([
    ['a tenant administrator who is not a platform admin', () => { mocks.session = sessionOf(adminOne) }],
    ['no session at all', () => { mocks.session = null }],
    ['a platform admin on a dedicated address', () => { mocks.session = sessionOf(platformAdmin); mocks.headers = new Headers({ host: hostA }) }],
  ])('refuses %s before opening the platform transaction', async (_label, arrange) => {
    arrange()
    await expect(listTenantsForPlatform(PAGE)).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('stops listing for an administrator whose attribute was removed, even with a token that still claims it', async () => {
    const demoted = await createUser('demoted', { platformAdmin: true })
    mocks.session = sessionOf(demoted)
    await expect(listTenantsForPlatform(PAGE)).resolves.toBeDefined()
    await withOwner(tx => tx.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, demoted.id)))
    await expect(listTenantsForPlatform(PAGE)).rejects.toThrow('Unauthorized')
  })

  it('keeps the default tenant visible to the list like any other', async () => {
    const { rows } = await listTenantsForPlatform(PAGE)
    expect(rowOf(rows, defaultTestTenant())).toMatchObject({ slug: 'default', isTemplate: false })
  })
})
