import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { tenantMembership, tenantSettings, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * L'interruttore delle registrazioni autonome (specifica 2026-10-21, §3.2, MT4-DEC-10) sul database di
 * prova. La guardia è quella vera (permessi letti dal database): è finta solo la sessione, che in un
 * processo Vitest non esiste. Due tenant nati dal modello, A e B; spariscono in afterAll.
 */
const mocks = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

const { setSelfRegistration } = await import('./tenant-settings-actions')

let A: TenantId
let B: TenantId
let admin: string
let registered: string
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

async function createUser(): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_tenant_settings_${unique()}@example.test`, idUserStatus: 2 })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

async function createTenant(name: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-ts-${unique()}`.slice(0, 40)}, ${name})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function addMember(tenantId: TenantId, userId: string, as: 'tenantAdmin' | 'registered'): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId })
    await tx.insert(userRole).values({ userId, idRole: system[as] })
  })
}

async function selfRegistrationOf(tenantId: TenantId): Promise<boolean | null> {
  const rows = await withTenant(tenantId, tx => tx.select({ on: tenantSettings.selfRegistration }).from(tenantSettings))
  return rows[0]?.on ?? null
}

function workingIn(userId: string, tenantId: TenantId) {
  mocks.session = { user: { id: userId, accountActive: true, tenantState: 'ready', tenantId }, expires: '2099-01-01T00:00:00.000Z' }
}

describeIntegration('tenant settings: self-registration switch', () => {
  beforeAll(async () => {
    A = await createTenant('ZZZ Settings A')
    B = await createTenant('ZZZ Settings B')
    admin = await createUser()
    registered = await createUser()
    await addMember(A, admin, 'tenantAdmin')
    await addMember(B, admin, 'tenantAdmin')
    await addMember(A, registered, 'registered')
  }, 60_000)

  beforeEach(async () => {
    // Punto di partenza uguale per ogni prova: A e B spenti, riga presente.
    for (const id of [A, B]) {
      await withTenant(id, tx => tx.insert(tenantSettings).values({ selfRegistration: false })
        .onConflictDoUpdate({ target: tenantSettings.idTenant, set: { selfRegistration: false } }))
    }
    mocks.session = null
  })

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  it('the tenant admin turns self registration on and off for their tenant only', async () => {
    workingIn(admin, A)
    await setSelfRegistration(true)
    expect(await selfRegistrationOf(A)).toBe(true)
    expect(await selfRegistrationOf(B)).toBe(false)

    await setSelfRegistration(false)
    expect(await selfRegistrationOf(A)).toBe(false)
    expect(await selfRegistrationOf(B)).toBe(false)

    // Lo stesso admin, che lavora in B: cambia B e lascia A com'è.
    workingIn(admin, B)
    await setSelfRegistration(true)
    expect(await selfRegistrationOf(B)).toBe(true)
    expect(await selfRegistrationOf(A)).toBe(false)
  })

  it('creates the row when it is missing, since a missing row counts as off', async () => {
    await withTenant(A, tx => tx.delete(tenantSettings).where(eq(tenantSettings.idTenant, A)))
    expect(await selfRegistrationOf(A)).toBeNull()

    workingIn(admin, A)
    await setSelfRegistration(true)
    expect(await selfRegistrationOf(A)).toBe(true)
  })

  it('a user without manage-tenant-settings is refused', async () => {
    workingIn(registered, A)
    await expect(setSelfRegistration(true)).rejects.toThrow('Unauthorized')
    expect(await selfRegistrationOf(A)).toBe(false)
  })

  it('a person without a chosen tenant, or without a session, is refused', async () => {
    mocks.session = { user: { id: admin, accountActive: true, tenantState: 'choose', tenantId: null }, expires: '2099-01-01T00:00:00.000Z' }
    await expect(setSelfRegistration(true)).rejects.toThrow('Unauthorized')
    mocks.session = null
    await expect(setSelfRegistration(true)).rejects.toThrow('Unauthorized')
    expect(await selfRegistrationOf(A)).toBe(false)
  })
})
