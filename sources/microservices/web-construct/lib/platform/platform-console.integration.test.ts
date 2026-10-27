import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform, withPlatform } from '@/lib/platform/db'
import { POST } from '@/app/api/platform/tenants-grid/route'
import PlatformLayout from '@/app/platform/layout'
import PlatformTenantsPage from '@/app/platform/page'
import PlatformAdminsPage from '@/app/platform/admins/page'

/**
 * La console contro il database vero (specifica 2026-10-26, MT5-DEC-3, MT5-DEC-4): il suo layout,
 * le sue pagine e la rotta della griglia si guardano da sole (un layout non protegge una rotta).
 * Una persona che non è amministratore di piattaforma, o un indirizzo dedicato, vedono come se la
 * console non esistesse: 404 per le pagine, 403 alla rotta per chi non è ammesso e 404 su un
 * indirizzo dedicato. Finti sono solo i confini di Next e i componenti client.
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
vi.mock('@/components/Layout', () => ({ Layout: () => null }))
vi.mock('@/components/platform/TenantsTableClient', () => ({ TenantsTableClient: () => null }))
vi.mock('@/components/platform/PlatformAdmins', () => ({ PlatformAdmins: () => null }))
vi.mock('@/lib/platform/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/platform/db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})

const MAIN_HOST = 'construct.example.test'
const createdUserIds: string[] = []
const createdTenants: TenantId[] = []
let platformAdmin: Person
let platformAdminWithTenant: Person
let tenantAdmin: Person
let dedicatedHost: string
let preexistingAdmins: string[] = []

type Person = { id: string; email: string }

function sessionOf(who: Person, hint = true) {
  return {
    user: { id: who.id, email: who.email, accountActive: true, tenantState: 'none', tenantId: null, isPlatformAdmin: hint },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

async function createUser(label: string, platform: boolean): Promise<Person> {
  const email = `zzz_console_${label}_${unique()}@example.test`
  const [row] = await withOwner(tx => tx.insert(users)
    .values({ email, idUserStatus: 2, authProvider: 'credentials', isPlatformAdmin: platform })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

async function joinDefaultTenant(who: Person, admin: boolean): Promise<void> {
  await withTenant(defaultTestTenant(), async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: who.id, status: 'active' })
    await tx.insert(userRole).values({ userId: who.id, idRole: system.registered })
    if (admin) await tx.insert(userRole).values({ userId: who.id, idRole: system.tenantAdmin })
  })
}

function gridRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/platform/tenants-grid', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  preexistingAdmins = (await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)))).map(row => row.id)
  platformAdmin = await createUser('padmin', true)
  platformAdminWithTenant = await createUser('pmember', true)
  tenantAdmin = await createUser('tadmin', false)
  await joinDefaultTenant(platformAdminWithTenant, false)
  await joinDefaultTenant(tenantAdmin, true)

  const [created] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-console-${unique()}`.slice(0, 40)}, 'ZZZ console')::text as id`))
  const tenantId = tenantIdForTest(Number(created.id))
  createdTenants.push(tenantId)
  dedicatedHost = `zzz-console-${unique()}.example.test`
  await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${dedicatedHost}, ${tenantId}, true)`))
}, 60_000)

afterAll(async () => {
  const errors: unknown[] = []
  for (const id of createdTenants) {
    try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
  }
  try { await withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))) } catch (error) { errors.push(error) }
  try { await closePlatform() } catch (error) { errors.push(error) }
  try { await closeOwner() } catch (error) { errors.push(error) }
  void preexistingAdmins
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => {
  mocks.session = sessionOf(platformAdmin)
  mocks.headers = new Headers({ host: MAIN_HOST })
  vi.mocked(withPlatform).mockClear()
})

describeIntegration('POST /api/platform/tenants-grid', () => {
  it('answers a platform admin with the rows and the total, the template first', async () => {
    const response = await POST(gridRequest({ page: 0, size: 50 }))
    expect(response.status).toBe(200)
    const body = await response.json() as { rows: { isTemplate: boolean; slug: string }[]; total: number }
    expect(body.rows[0]).toMatchObject({ isTemplate: true, slug: 'template' })
    expect(body.total).toBeGreaterThanOrEqual(body.rows.length)
  })

  it('answers 403 to a tenant administrator who is not a platform admin, whatever their token says', async () => {
    mocks.session = sessionOf(tenantAdmin, true)
    const response = await POST(gridRequest({ page: 0, size: 50 }))
    expect(response.status).toBe(403)
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('answers 403 when nobody is signed in', async () => {
    mocks.session = null
    expect((await POST(gridRequest({ page: 0, size: 50 }))).status).toBe(403)
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('answers 404 on a dedicated address, to a platform admin and to anyone else', async () => {
    mocks.headers = new Headers({ host: dedicatedHost })
    expect((await POST(gridRequest({ page: 0, size: 50 }))).status).toBe(404)
    mocks.session = sessionOf(tenantAdmin, false)
    expect((await POST(gridRequest({ page: 0, size: 50 }))).status).toBe(404)
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('answers 400 to a body that is not a valid query, after checking who asks', async () => {
    expect((await POST(gridRequest({ page: 0, size: 5000 }))).status).toBe(400)
    expect((await POST(gridRequest({ page: 0, size: 50, status: 'deleted' }))).status).toBe(400)
    const notJson = new NextRequest('http://localhost:3000/api/platform/tenants-grid', { method: 'POST', body: 'nope' })
    expect((await POST(notJson)).status).toBe(400)
    mocks.session = sessionOf(tenantAdmin, true)
    expect((await POST(gridRequest({ page: 5000, size: 5000 }))).status).toBe(403)
  })
})

describeIntegration('the console pages and layout', () => {
  const searchParams = Promise.resolve({})

  it.each([
    ['the tenant list', () => PlatformTenantsPage({ searchParams })],
    ['the administrators page', () => PlatformAdminsPage()],
    ['the console layout', () => PlatformLayout({ children: null })],
  ])('%s renders for a platform admin on the main address', async (_label, render) => {
    await expect(render()).resolves.toBeDefined()
  })

  it.each([
    ['the tenant list', () => PlatformTenantsPage({ searchParams })],
    ['the administrators page', () => PlatformAdminsPage()],
    ['the console layout', () => PlatformLayout({ children: null })],
  ])('%s is a 404 for a tenant administrator, a signed-out visitor and a dedicated address', async (_label, render) => {
    mocks.session = sessionOf(tenantAdmin, true)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.session = null
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.session = sessionOf(platformAdmin)
    mocks.headers = new Headers({ host: dedicatedHost })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('lists the platform administrators, with the signed-in one marked by id, and nothing from any tenant', async () => {
    mocks.session = sessionOf(platformAdmin)
    const element = await PlatformAdminsPage() as unknown as { props: { children: { props: { admins: { id: string; email: string; name: string | null; active: boolean }[]; currentUserId: string } } } }
    const { admins, currentUserId } = element.props.children.props
    expect(currentUserId).toBe(platformAdmin.id)
    expect(admins.some(admin => admin.id === platformAdmin.id && admin.active)).toBe(true)
    expect(admins.some(admin => admin.id === tenantAdmin.id)).toBe(false)
    for (const admin of admins) expect(Object.keys(admin).sort()).toEqual(['active', 'email', 'id', 'name'])
  })

  it('gives the console menu a way back only to a person who belongs to a tenant on this address', async () => {
    const menuOf = async (who: Person) => {
      mocks.session = sessionOf(who)
      const element = await PlatformLayout({ children: null }) as unknown as { props: { menuItems: { route?: string; label: string }[] } }
      return element.props.menuItems
    }
    const without = await menuOf(platformAdmin)
    expect(without.some(item => item.route === '/')).toBe(false)
    expect(without.map(item => item.route).filter(Boolean)).toEqual(['/platform', '/platform/admins'])

    const withTenantMenu = await menuOf(platformAdminWithTenant)
    expect(withTenantMenu.some(item => item.route === '/')).toBe(true)
  })

  it('the tenant list page passes the address of the page to the grid', async () => {
    const element = await PlatformTenantsPage({ searchParams: Promise.resolve({ status: 'archived', sort: 'slug', direction: 'DESC', search: 'Ac' }) }) as unknown as
      { props: { children: { props: Record<string, unknown> } } }
    const grid = element.props.children
    expect(grid.props).toMatchObject({ status: 'archived', sortField: 'slug', sortDir: 'DESC', search: 'Ac' })
  })
})
