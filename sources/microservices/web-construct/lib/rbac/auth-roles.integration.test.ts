import { afterAll, beforeAll, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { permission, role, rolePermission, tenant, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import { getSystemRoleIds, type SystemRoleIds } from '@/lib/tenancy/system-roles'
import { resolveUserAuthorization } from './auth-roles'
import { resolveActor } from './actor'
import { PERMISSION_CODES } from './permission-catalog'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from './types'

/**
 * Fissa il comportamento dell'autorizzazione (specifica 2026-10-15, §2.2): i casi limite devono
 * dare lo stesso risultato prima e dopo il passaggio all'istruzione unica. Le righe create qui si
 * cancellano per id; il tenant predefinito si legge e vi si scrivono solo utenti, un ruolo di
 * servizio e le loro assegnazioni, mai i ruoli di sistema.
 */
const TENANT = defaultTestTenant()
const ROLE_TYPE_SYSTEM = 1
const ROLE_TYPE_SERVICE = 2

let system: SystemRoleIds
let readerRoleId: number
let adminUserId: string
let readerUserId: string
let plainUserId: string
let deactivatedAdminUserId: string
let revokedAdminUserId: string
let registeredOnlyUserId: string
let emptyTenant: ReturnType<typeof tenantIdForTest> | undefined
// Un secondo tenant con i propri ruoli di sistema e un ruolo di servizio che concede read-users.
let otherTenant: ReturnType<typeof tenantIdForTest> | undefined
let otherRegisteredId: number
let otherServiceRoleId: number
// Ruoli in entrambi i tenant: lettore in A (read-menu) e in B (read-users).
let bothTenantsUserId: string
// Amministratore in A, soltanto ruolo base in B.
let adminInAOnlyUserId: string
// Attivo nel predefinito, disattivato in B (con il ruolo base in B).
let activeInAOffInBUserId: string
// Attivo nel predefinito, senza alcuna appartenenza in B.
let activeInAUnknownInBUserId: string
// Membro attivo soltanto di B.
let onlyInBUserId: string
// Appartenenza al predefinito disattivata, senza ruoli.
let deactivatedInAUserId: string
const createdUserIds: string[] = []

async function createUser(status: number): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_authroles_${unique()}@example.test`, idUserStatus: status })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

/** L'appartenenza attiva al tenant predefinito, come la 0048 la dà a ogni utente esistente. */
async function joinTenant(userId: string): Promise<void> {
  await withTenant(TENANT, tx => tx.insert(tenantMembership).values({ userId }))
}

async function grantRoles(userId: string, roleIds: number[]): Promise<void> {
  if (roleIds.length === 0) return
  // I ruoli esistono solo con l'appartenenza al tenant (0048).
  await joinTenant(userId)
  await withTenant(TENANT, tx => tx.insert(userRole).values(roleIds.map(idRole => ({ userId, idRole }))))
}

/** I ruoli letti non hanno un ordine garantito dalla query vecchia: il confronto li ordina. */
async function authorizationOf(userId: string, ensureRegisteredRole = false) {
  const authorization = await resolveUserAuthorization(TENANT, userId, ensureRegisteredRole)
  return { ...authorization, roleIds: [...authorization.roleIds].sort((a, b) => a - b) }
}

async function membershipStatusIn(tenantId: ReturnType<typeof tenantIdForTest>, userId: string): Promise<string | null> {
  const rows = await withTenant(tenantId, tx => tx.select({ status: tenantMembership.status }).from(tenantMembership).where(eq(tenantMembership.userId, userId)))
  return rows[0]?.status ?? null
}

async function rolesOf(userId: string): Promise<number[]> {
  const rows = await withTenant(TENANT, tx => tx.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId)))
  return rows.map(row => row.idRole).sort((a, b) => a - b)
}

describeIntegration('authorization reads', () => {
  beforeAll(async () => {
    system = await withTenant(TENANT, tx => getSystemRoleIds(tx))
    // Un ruolo di servizio che concede read-menu, solo di questo file.
    readerRoleId = await withTenant(TENANT, async tx => {
      const [created] = await tx.insert(role)
        .values({ description: `zzz_authroles_${unique()}`, idRoleType: ROLE_TYPE_SERVICE })
        .returning({ idRole: role.idRole })
      const [perm] = await tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'read-menu'))
      await tx.insert(rolePermission).values({ idRole: created.idRole, idPermission: perm.idPermission })
      return created.idRole
    })
    adminUserId = await createUser(USER_STATUS_ACTIVE)
    readerUserId = await createUser(USER_STATUS_ACTIVE)
    plainUserId = await createUser(USER_STATUS_ACTIVE)
    deactivatedAdminUserId = await createUser(USER_STATUS_DEACTIVATED)
    revokedAdminUserId = await createUser(USER_STATUS_ACTIVE)
    registeredOnlyUserId = await createUser(USER_STATUS_ACTIVE)
    await grantRoles(adminUserId, [system.registered, system.tenantAdmin])
    await grantRoles(readerUserId, [readerRoleId])
    await grantRoles(deactivatedAdminUserId, [system.registered, system.tenantAdmin])
    await grantRoles(revokedAdminUserId, [system.registered, system.tenantAdmin])
    // Membro attivo senza ruoli: l'autorizzazione ora richiede l'appartenenza (0048, Task 2).
    await joinTenant(plainUserId)
    // Membro senza ruoli: ensureRegisteredRole gli aggiunge il ruolo base.
    await joinTenant(registeredOnlyUserId)
    // Un tenant senza i due ruoli di sistema: la sola cosa che ci vive è il tenant stesso.
    const [created] = await withOwner(tx => tx.insert(tenant)
      .values({ slug: `zzz-authroles-${unique()}`.slice(0, 40), name: 'Authorization without system roles' })
      .returning({ id: tenant.id }))
    emptyTenant = tenantIdForTest(created.id)

    // Il tenant B: una volta creato l'id, la pulizia lo trova anche se i passi dopo falliscono.
    const [other] = await withOwner(tx => tx.insert(tenant)
      .values({ slug: `zzz-authroles-b-${unique()}`.slice(0, 40), name: 'Authorization other tenant' })
      .returning({ id: tenant.id }))
    otherTenant = tenantIdForTest(other.id)
    bothTenantsUserId = await createUser(USER_STATUS_ACTIVE)
    adminInAOnlyUserId = await createUser(USER_STATUS_ACTIVE)
    await grantRoles(bothTenantsUserId, [readerRoleId])
    await grantRoles(adminInAOnlyUserId, [system.registered, system.tenantAdmin])
    activeInAOffInBUserId = await createUser(USER_STATUS_ACTIVE)
    activeInAUnknownInBUserId = await createUser(USER_STATUS_ACTIVE)
    onlyInBUserId = await createUser(USER_STATUS_ACTIVE)
    deactivatedInAUserId = await createUser(USER_STATUS_ACTIVE)
    await grantRoles(activeInAOffInBUserId, [system.registered])
    await grantRoles(activeInAUnknownInBUserId, [system.registered])
    await withTenant(TENANT, tx => tx.insert(tenantMembership).values({ userId: deactivatedInAUserId, status: 'deactivated' }))
    await withOwner(async tx => {
      const [registered] = await tx.insert(role).values({ description: 'B registered', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
      await tx.insert(role).values({ description: 'B admin', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'TENANT_ADMIN' })
      const [service] = await tx.insert(role).values({ description: `zzz_authroles_b_${unique()}`, idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
      const [perm] = await tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'read-users'))
      await tx.insert(rolePermission).values({ idRole: service.idRole, idPermission: perm.idPermission })
      await tx.insert(tenantMembership).values([
        { userId: bothTenantsUserId }, { userId: adminInAOnlyUserId }, { userId: onlyInBUserId },
        { userId: activeInAOffInBUserId, status: 'deactivated' },
      ])
      await tx.insert(userRole).values([
        { userId: onlyInBUserId, idRole: registered.idRole },
        { userId: activeInAOffInBUserId, idRole: registered.idRole },
        { userId: bothTenantsUserId, idRole: service.idRole },
        { userId: adminInAOnlyUserId, idRole: registered.idRole },
      ])
      otherRegisteredId = registered.idRole
      otherServiceRoleId = service.idRole
    }, otherTenant)
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    // user_role e role_permission spariscono con gli utenti e con il ruolo (ON DELETE CASCADE).
    if (readerRoleId !== undefined) await step(() => withTenant(TENANT, tx => tx.delete(role).where(eq(role.idRole, readerRoleId))))
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    if (otherTenant !== undefined) {
      // Ogni delete nomina il tenant B: senza la sua policy un delete senza where toccherebbe anche A.
      await step(() => withOwner(async tx => {
        await tx.delete(tenantMembership).where(eq(tenantMembership.idTenant, otherTenant!))
        await tx.delete(userRole).where(eq(userRole.idTenant, otherTenant!))
        await tx.delete(role).where(eq(role.idTenant, otherTenant!))
      }, otherTenant))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, otherTenant!))))
    }
    if (emptyTenant !== undefined) await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, emptyTenant!))))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  })

  it('an active administrator gets both roles, is admin and receives every catalogue code', async () => {
    expect(await authorizationOf(adminUserId)).toEqual({
      accountActive: true,
      roleIds: [system.registered, system.tenantAdmin].sort((a, b) => a - b),
      isAdmin: true,
    })
    const actor = await resolveActor(TENANT, adminUserId)
    expect(actor?.isAdmin).toBe(true)
    expect([...(actor?.permissions ?? [])].sort()).toEqual([...PERMISSION_CODES].sort())
  })

  it('an active user whose role grants read-menu gets that role and that code only', async () => {
    expect(await authorizationOf(readerUserId)).toEqual({ accountActive: true, roleIds: [readerRoleId], isAdmin: false })
    const actor = await resolveActor(TENANT, readerUserId)
    expect(actor?.roleIds).toEqual([readerRoleId])
    expect([...(actor?.permissions ?? [])]).toEqual(['read-menu'])
  })

  it('an active user without roles has no roles and no permissions', async () => {
    expect(await authorizationOf(plainUserId)).toEqual({ accountActive: true, roleIds: [], isAdmin: false })
    const actor = await resolveActor(TENANT, plainUserId)
    expect(actor).not.toBeNull()
    expect(actor?.roleIds).toEqual([])
    expect(actor?.isAdmin).toBe(false)
    expect([...(actor?.permissions ?? [])]).toEqual([])
  })

  it('a deactivated administrator is neither active nor admin, and is no actor', async () => {
    expect(await authorizationOf(deactivatedAdminUserId)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(await resolveActor(TENANT, deactivatedAdminUserId)).toBeNull()
  })

  it('an unknown user is neither active nor admin, and is no actor', async () => {
    const unknown = crypto.randomUUID()
    expect(await authorizationOf(unknown)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(await resolveActor(TENANT, unknown)).toBeNull()
  })

  it('a tenant without system roles refuses with "system roles missing"', async () => {
    await expect(resolveUserAuthorization(emptyTenant!, adminUserId)).rejects.toThrow('system roles missing')
    await expect(resolveActor(emptyTenant!, adminUserId)).rejects.toThrow('system roles missing')
  })

  it('a revocation between two calls takes effect on the second call', async () => {
    const before = await authorizationOf(revokedAdminUserId)
    expect(before.isAdmin).toBe(true)
    expect([...((await resolveActor(TENANT, revokedAdminUserId))?.permissions ?? [])].sort()).toEqual([...PERMISSION_CODES].sort())

    await withTenant(TENANT, tx => tx.delete(userRole)
      .where(and(eq(userRole.userId, revokedAdminUserId), eq(userRole.idRole, system.tenantAdmin))))

    const after = await authorizationOf(revokedAdminUserId)
    expect(after).toEqual({ accountActive: true, roleIds: [system.registered], isAdmin: false })
    const actor = await resolveActor(TENANT, revokedAdminUserId)
    expect(actor?.isAdmin).toBe(false)
    expect([...(actor?.permissions ?? [])]).toEqual([])
  })

  it('ensureRegisteredRole adds the REGISTERED role to an active user and writes the row', async () => {
    expect(await rolesOf(registeredOnlyUserId)).toEqual([])
    expect(await authorizationOf(registeredOnlyUserId, true))
      .toEqual({ accountActive: true, roleIds: [system.registered], isAdmin: false })
    expect(await rolesOf(registeredOnlyUserId)).toEqual([system.registered])
    // Una seconda chiamata non duplica e non cambia nulla.
    expect(await authorizationOf(registeredOnlyUserId, true))
      .toEqual({ accountActive: true, roleIds: [system.registered], isAdmin: false })
  })

  it('does not write a role when ensureRegisteredRole is off, nor for a deactivated user', async () => {
    const lone = await createUser(USER_STATUS_ACTIVE)
    await resolveUserAuthorization(TENANT, lone)
    expect(await rolesOf(lone)).toEqual([])
    const off = await createUser(USER_STATUS_DEACTIVATED)
    expect(await authorizationOf(off, true)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(await rolesOf(off)).toEqual([])
  })

  it('the snapshot of a tenant never includes the roles or permission codes of another tenant', async () => {
    // Lo stesso utente ha ruoli in due tenant: ognuno vede solo i propri, e i codici sono quelli
    // concessi dai ruoli del proprio tenant.
    const inA = await resolveActor(TENANT, bothTenantsUserId)
    expect(inA?.roleIds).toEqual([readerRoleId])
    expect([...(inA?.permissions ?? [])]).toEqual(['read-menu'])
    expect(await authorizationOf(bothTenantsUserId)).toEqual({ accountActive: true, roleIds: [readerRoleId], isAdmin: false })

    // Controllo contro un passaggio a vuoto: B ha davvero dei ruoli per questo utente.
    const inB = await resolveActor(otherTenant!, bothTenantsUserId)
    expect(inB?.roleIds).toEqual([otherServiceRoleId])
    expect([...(inB?.permissions ?? [])]).toEqual(['read-users'])
    const authorizationInB = await resolveUserAuthorization(otherTenant!, bothTenantsUserId)
    expect(authorizationInB).toEqual({ accountActive: true, roleIds: [otherServiceRoleId], isAdmin: false })
  })

  it('administrator in one tenant is not administrator in another', async () => {
    const inA = await resolveActor(TENANT, adminInAOnlyUserId)
    expect(inA?.isAdmin).toBe(true)
    expect([...(inA?.permissions ?? [])].sort()).toEqual([...PERMISSION_CODES].sort())

    const inB = await resolveActor(otherTenant!, adminInAOnlyUserId)
    expect(inB?.isAdmin).toBe(false)
    expect(inB?.roleIds).toEqual([otherRegisteredId])
    expect([...(inB?.permissions ?? [])]).toEqual([])
    expect(await resolveUserAuthorization(otherTenant!, adminInAOnlyUserId))
      .toEqual({ accountActive: true, roleIds: [otherRegisteredId], isAdmin: false })
  })

  it('a person active in the default tenant and deactivated in B is authorized only in the default tenant', async () => {
    expect((await resolveUserAuthorization(TENANT, activeInAOffInBUserId)).accountActive).toBe(true)
    expect((await resolveUserAuthorization(otherTenant!, activeInAOffInBUserId)).accountActive).toBe(false)
    expect(await resolveActor(TENANT, activeInAOffInBUserId)).not.toBeNull()
    expect(await resolveActor(otherTenant!, activeInAOffInBUserId)).toBeNull()
  })

  it('a person with no membership in B is not authorized in B', async () => {
    expect((await resolveUserAuthorization(TENANT, activeInAUnknownInBUserId)).accountActive).toBe(true)
    expect(await resolveUserAuthorization(otherTenant!, activeInAUnknownInBUserId))
      .toEqual({ accountActive: false, roleIds: [], isAdmin: false })
  })

  it('first sign-in creates the default membership and the base role', async () => {
    const fresh = await createUser(USER_STATUS_ACTIVE)
    expect(await membershipStatusIn(TENANT, fresh)).toBeNull()
    expect(await authorizationOf(fresh, true)).toEqual({ accountActive: true, roleIds: [system.registered], isAdmin: false })
    expect(await membershipStatusIn(TENANT, fresh)).toBe('active')
    expect(await rolesOf(fresh)).toEqual([system.registered])
    expect(await membershipStatusIn(otherTenant!, fresh)).toBeNull()
    expect(await withTenant(otherTenant!, tx => tx.select().from(userRole).where(eq(userRole.userId, fresh)))).toEqual([])
  })

  it('first sign-in creates nothing in the default tenant for a member of B', async () => {
    expect(await authorizationOf(onlyInBUserId, true)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(await membershipStatusIn(TENANT, onlyInBUserId)).toBeNull()
    expect(await rolesOf(onlyInBUserId)).toEqual([])
    // Controllo contro un passaggio a vuoto: in B la persona è attiva e ha il suo ruolo.
    expect(await membershipStatusIn(otherTenant!, onlyInBUserId)).toBe('active')
    expect(await resolveUserAuthorization(otherTenant!, onlyInBUserId))
      .toEqual({ accountActive: true, roleIds: [otherRegisteredId], isAdmin: false })
  })

  it('first sign-in leaves a deactivated default membership deactivated and adds no role', async () => {
    expect(await authorizationOf(deactivatedInAUserId, true)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(await membershipStatusIn(TENANT, deactivatedInAUserId)).toBe('deactivated')
    expect(await rolesOf(deactivatedInAUserId)).toEqual([])
  })
})
