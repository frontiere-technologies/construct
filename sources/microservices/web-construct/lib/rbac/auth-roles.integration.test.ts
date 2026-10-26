import { afterAll, beforeAll, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { permission, role, rolePermission, tenant, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import { getSystemRoleIds, type SystemRoleIds } from '@/lib/tenancy/system-roles'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { revalidateTokenTenant, type TokenTenant } from '@/lib/tenancy/token-tenant'
import { resolveUserAuthorization, selectAuthorizationSnapshot } from './auth-roles'
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

/**
 * Il tenant del token rivalidato a ogni richiesta (specifica 2026-10-21, §3.1, MT4-DEC-7; Review
 * Focus #1 e #4). Tenant nati dal modello in beforeAll: A e B con un indirizzo dedicato ciascuno
 * (nomi unici per esecuzione al posto di `a.localhost` e `b.localhost`), C e D sull'indirizzo
 * principale, S sospeso. Spariscono in afterAll con le persone di prova.
 */
// Ogni caso fa una ventina di viaggi in serie verso il database di prova remoto: più dei 5 s
// predefiniti. Il tempo esplicito sta su ogni caso.
describeIntegration('tenant in the token, revalidated on every request', () => {
  let A: TenantId
  let B: TenantId
  let C: TenantId
  let D: TenantId
  let S: TenantId
  let template: TenantId
  let aHost: string
  let bHost: string
  const tenants: TenantId[] = []
  const people: string[] = []

  async function createPerson(): Promise<string> {
    const [row] = await withGlobal(tx => tx.insert(users)
      .values({ email: `zzz_tokentenant_${unique()}@example.test`, idUserStatus: USER_STATUS_ACTIVE })
      .returning({ id: users.id }))
    people.push(row.id)
    return row.id
  }

  async function createTenant(name: string): Promise<TenantId> {
    const [row] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${`zzz-tt-${unique()}`.slice(0, 40)}, ${name})::text as id`))
    const id = tenantIdForTest(Number(row.id))
    tenants.push(id)
    return id
  }

  /** Appartenenza attiva con il ruolo base nel tenant indicato. */
  async function join(tenantId: TenantId, userId: string): Promise<void> {
    await withTenant(tenantId, async tx => {
      const system = await getSystemRoleIds(tx)
      await tx.insert(tenantMembership).values({ userId })
      await tx.insert(userRole).values({ userId, idRole: system.registered })
    })
  }

  async function deactivate(tenantId: TenantId, userId: string): Promise<void> {
    await withTenant(tenantId, tx => tx.update(tenantMembership)
      .set({ status: 'deactivated' })
      .where(eq(tenantMembership.userId, userId)))
  }

  async function eligible(tenantId: TenantId, host: string | null, userId: string): Promise<boolean | null> {
    return withTenant(tenantId, async tx => (await selectAuthorizationSnapshot(tx, userId, { host })).tenantEligible)
  }

  function readyToken(tenantId: TenantId, host: string | null): TokenTenant {
    return { tenantId, tenantState: 'ready', tenantHost: host, tenantName: null, accountActive: true, roleIds: [] }
  }

  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(Number(found.id))
    A = await createTenant('ZZZ Token A')
    B = await createTenant('ZZZ Token B')
    C = await createTenant('ZZZ Token C')
    D = await createTenant('ZZZ Token D')
    S = await createTenant('ZZZ Token S')
    aHost = `zzz-tt-a-${unique()}.localhost`
    bHost = `zzz-tt-b-${unique()}.localhost`
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${aHost}, ${A}, true), (${bHost}, ${B}, true)`)
      await tx.execute(sql`update public.tenant set status = 'suspended' where id = ${S}`)
    })
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    // Appartenenze e ruoli delle persone di prova spariscono con loro (ON DELETE CASCADE).
    if (people.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, people))))
    for (const id of tenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  it('tenant_eligible is false for the template, a suspended tenant, or a tenant not on the host', async () => {
    const person = await createPerson()
    // Controllo contro un passaggio a vuoto: il predefinito sull'indirizzo principale e A sul suo.
    expect(await eligible(TENANT, null, person)).toBe(true)
    expect(await eligible(TENANT, 'LOCALHOST:3000', person)).toBe(true)
    expect(await eligible(A, aHost, person)).toBe(true)
    expect(await eligible(A, `${aHost.toUpperCase()}:3000`, person)).toBe(true)

    expect(await eligible(template, null, person)).toBe(false)
    expect(await eligible(S, null, person)).toBe(false)
    // Un tenant dedicato non risponde sull'indirizzo principale, né su quello di un altro tenant.
    expect(await eligible(A, null, person)).toBe(false)
    expect(await eligible(A, bHost, person)).toBe(false)
    // Il predefinito non risponde su un indirizzo dedicato.
    expect(await eligible(TENANT, aHost, person)).toBe(false)
    // Senza host il controllo non c'è: la lettura dell'autorizzazione resta quella di prima.
    expect(await withTenant(TENANT, async tx => (await selectAuthorizationSnapshot(tx, person)).tenantEligible)).toBeNull()
  }, 30_000)

  it('a token for B presented on a.localhost is not ready', async () => {
    const onlyB = await createPerson()
    await join(B, onlyB)
    // Controllo contro un passaggio a vuoto: su b il token resta in B.
    expect(await revalidateTokenTenant(onlyB, readyToken(B, bHost), bHost)).toMatchObject({ tenantId: B, tenantState: 'ready', accountActive: true })

    // Il token scelto su b, presentato su a (cookie copiato, client non browser).
    const moved = await revalidateTokenTenant(onlyB, readyToken(B, bHost), aHost)
    expect(moved).toMatchObject({ tenantId: null, tenantState: 'none', tenantHost: aHost, roleIds: [] })
    // Anche con l'indirizzo del token che coincide con quello della richiesta: decide il registro.
    const forged = await revalidateTokenTenant(onlyB, readyToken(B, aHost), aHost)
    expect(forged).toMatchObject({ tenantId: null, tenantState: 'none', roleIds: [] })

    // Chi è membro sia di A sia di B, su a, non finisce mai in B. Il token scelto su b si ricalcola
    // su a ed entra in A; quello che dice di essere stato scelto su a, e lì non supera i controlli,
    // va alla scelta (MT4-DEC-7), dove compare solo A.
    const both = await createPerson()
    await join(A, both)
    await join(B, both)
    expect(await revalidateTokenTenant(both, readyToken(B, bHost), aHost))
      .toMatchObject({ tenantId: A, tenantState: 'ready', tenantHost: aHost })
    expect(await revalidateTokenTenant(both, readyToken(B, aHost), aHost))
      .toMatchObject({ tenantId: null, tenantState: 'choose', tenantHost: aHost, roleIds: [] })
  }, 30_000)

  it('a membership deactivated during the session moves the token to choose or none at the next request', async () => {
    // Con altri due tenant sull'indirizzo: la scelta.
    const withOthers = await createPerson()
    await join(TENANT, withOthers)
    await join(C, withOthers)
    await join(D, withOthers)
    expect(await revalidateTokenTenant(withOthers, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: TENANT, tenantState: 'ready', accountActive: true })
    await deactivate(TENANT, withOthers)
    expect(await revalidateTokenTenant(withOthers, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: null, tenantState: 'choose', accountActive: true, roleIds: [] })

    // Senza altri tenant sull'indirizzo: il messaggio.
    const alone = await createPerson()
    await join(TENANT, alone)
    expect(await revalidateTokenTenant(alone, readyToken(TENANT, null), null)).toMatchObject({ tenantId: TENANT, tenantState: 'ready' })
    await deactivate(TENANT, alone)
    expect(await revalidateTokenTenant(alone, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: null, tenantState: 'none', roleIds: [] })

    // Un tenant sospeso durante la sessione vale lo stesso.
    const inC = await createPerson()
    await join(C, inC)
    expect(await revalidateTokenTenant(inC, readyToken(C, null), null)).toMatchObject({ tenantId: C, tenantState: 'ready' })
    await withOwner(tx => tx.execute(sql`update public.tenant set status = 'suspended' where id = ${C}`))
    try {
      expect(await revalidateTokenTenant(inC, readyToken(C, null), null)).toMatchObject({ tenantId: null, tenantState: 'none' })
    } finally {
      await withOwner(tx => tx.execute(sql`update public.tenant set status = 'active' where id = ${C}`))
    }
  }, 30_000)

  it('a failed revalidation on the same host never enters the only other tenant nor the last used one', async () => {
    // Un solo altro tenant sull'indirizzo: la scelta, non l'ingresso diretto in quell'altro.
    const oneOther = await createPerson()
    await join(TENANT, oneOther)
    await join(C, oneOther)
    expect(await revalidateTokenTenant(oneOther, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: TENANT, tenantState: 'ready' })
    await deactivate(TENANT, oneOther)
    expect(await revalidateTokenTenant(oneOther, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: null, tenantState: 'choose', tenantHost: null, accountActive: true, roleIds: [] })

    // Più tenant e l'ultimo usato fra loro: la scelta, non l'ultimo usato.
    const withLast = await createPerson()
    await join(TENANT, withLast)
    await join(C, withLast)
    await join(D, withLast)
    await withGlobal(tx => tx.update(users).set({ lastTenantId: D }).where(eq(users.id, withLast)))
    await deactivate(TENANT, withLast)
    expect(await revalidateTokenTenant(withLast, readyToken(TENANT, null), null))
      .toMatchObject({ tenantId: null, tenantState: 'choose', roleIds: [] })

    // Nessun altro tenant sull'indirizzo dedicato: il messaggio.
    const onA = await createPerson()
    await join(A, onA)
    await deactivate(A, onA)
    expect(await revalidateTokenTenant(onA, readyToken(A, aHost), aHost))
      .toMatchObject({ tenantId: null, tenantState: 'none', tenantHost: aHost, roleIds: [] })
  }, 30_000)

  it('a token chosen on another host is still recomputed on the request host', async () => {
    // Scelto con `localhost`, presentato senza indirizzo (lo stesso indirizzo principale nel
    // registro, ma un'altra stringa): si ricalcola ed entra nell'unico tenant disponibile.
    const moved = await createPerson()
    await join(TENANT, moved)
    await join(C, moved)
    await deactivate(TENANT, moved)
    expect(await revalidateTokenTenant(moved, readyToken(TENANT, 'localhost'), null))
      .toMatchObject({ tenantId: C, tenantState: 'ready', tenantHost: null })
  }, 30_000)
})
