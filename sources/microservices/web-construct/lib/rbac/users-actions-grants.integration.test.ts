import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, role, rolePermission, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'

const guard = vi.hoisted(() => ({
  actor: { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() },
}))
vi.mock('@/lib/rbac/auth-guard', () => ({
  requirePermission: async () => guard.actor,
  requireAdministrator: async () => guard.actor,
}))

const { updateUserRoles, setUserStatus } = await import('./users-actions')

const ACTIVE = 2
const ROLE_TYPE_SERVICE = 2
const created: string[] = []
const createdRoles: number[] = []
const createdPermissions: number[] = []

/** Un ruolo di servizio con le sole concessioni indicate (id di riga `permission`). */
async function makeRole(permissionIds: number[]): Promise<number> {
  const [created] = await db.insert(role)
    .values({ description: `zzz_grants_${unique()}`, idRoleType: ROLE_TYPE_SERVICE })
    .returning({ idRole: role.idRole })
  createdRoles.push(created.idRole)
  if (permissionIds.length) {
    await db.insert(rolePermission).values(permissionIds.map(idPermission => ({ idRole: created.idRole, idPermission })))
  }
  return created.idRole
}

async function permissionId(code: string): Promise<number> {
  const [row] = await db.select({ id: permission.idPermission }).from(permission).where(eq(permission.code, code))
  expect(row).toBeDefined()
  return row.id
}

/** Una riga GRANT senza codice: fuori dal catalogo, nessuno la possiede. */
async function makeUncodedGrant(): Promise<number> {
  const [row] = await db.insert(permission)
    .values({ name: `zzz_grants_${unique()}`, kind: 'GRANT', origin: 'CONSOLE' })
    .returning({ id: permission.idPermission })
  createdPermissions.push(row.id)
  return row.id
}

async function makeUser(roleIds: number[]): Promise<string> {
  const [user] = await db.insert(users).values({
    email: `zzz_grants_${unique()}@example.com`,
    authProvider: 'credentials',
    idUserStatus: ACTIVE,
  }).returning({ id: users.id })
  created.push(user.id)
  await db.insert(userRole).values(roleIds.map(idRole => ({ userId: user.id, idRole })))
  return user.id
}

const rolesOf = async (userId: string) =>
  (await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId)))
    .map(row => row.idRole).sort((a, b) => a - b)

const statusOf = async (userId: string) =>
  (await db.select({ s: users.idUserStatus }).from(users).where(eq(users.id, userId)))[0].s

describeIntegration('user role and status actions with a limited actor', () => {
  beforeEach(() => {
    guard.actor = {
      userId: crypto.randomUUID(),
      roleIds: [0],
      isAdmin: false,
      permissions: new Set(['assign-user-roles', 'set-user-status']),
    }
  })

  afterEach(async () => {
    guard.actor = { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set() }
    for (const id of created.splice(0)) await db.delete(users).where(eq(users.id, id))
    // user_role e role_permission cascatano dal ruolo; la riga permission va tolta a parte.
    const roleIds = createdRoles.splice(0)
    if (roleIds.length) await db.delete(role).where(inArray(role.idRole, roleIds))
    const permissionIds = createdPermissions.splice(0)
    if (permissionIds.length) await db.delete(permission).where(inArray(permission.idPermission, permissionIds))
  })

  it('refuses assigning the Administrator role (number)', async () => {
    const target = await makeUser([0])
    await expect(updateUserRoles(target, [0, 1])).rejects.toThrow(/Administrator/)
    expect(await rolesOf(target)).toEqual([0])
  })

  it('refuses assigning the Administrator role smuggled as a string', async () => {
    const target = await makeUser([0])
    await expect(updateUserRoles(target, ['1'] as unknown as number[])).rejects.toThrow(/Invalid input/)
    expect(await rolesOf(target)).toEqual([0])
  })

  it('refuses a non-uuid user id', async () => {
    await expect(updateUserRoles('not-a-uuid', [0])).rejects.toThrow(/Invalid input/)
  })

  it('refuses removing the Administrator role from an administrator', async () => {
    const target = await makeUser([0, 1])
    await expect(updateUserRoles(target, [0])).rejects.toThrow(/Administrator/)
    expect(await rolesOf(target)).toEqual([0, 1])
  })

  it('refuses deactivating an administrator', async () => {
    const target = await makeUser([0, 1])
    await expect(setUserStatus(target, 1)).rejects.toThrow(/administrator/)
    expect(await statusOf(target)).toBe(ACTIVE)
  })

  it('refuses a status that is not a real status id', async () => {
    const target = await makeUser([0])
    await expect(setUserStatus(target, 99 as unknown as 1)).rejects.toThrow(/Invalid input/)
  })

  // Il rovescio dei rifiuti (I2 della revisione finale): DEC-29 limita, non blocca. Chi possiede
  // l'unica concessione di un ruolo può assegnarlo.
  it('lets a limited actor assign a role whose grants it holds all (DEC-29)', async () => {
    const reader = await makeRole([await permissionId('read-menu')])
    guard.actor = { ...guard.actor, permissions: new Set(['assign-user-roles', 'read-menu']) }
    const target = await makeUser([0])
    await updateUserRoles(target, [0, reader])
    expect(await rolesOf(target)).toEqual([0, reader].sort((a, b) => a - b))
  })

  // M3 della revisione finale: una riga GRANT senza codice non è nel catalogo e nessuno la
  // possiede. Concederla a un ruolo è già rifiutato (permissionCodesByIds); assegnare un ruolo che
  // la porta deve esserlo allo stesso modo, o il controllo la salterebbe in silenzio.
  it('refuses assigning a role that holds a GRANT row outside the catalog', async () => {
    const odd = await makeRole([await permissionId('read-menu'), await makeUncodedGrant()])
    guard.actor = { ...guard.actor, permissions: new Set(['assign-user-roles', 'read-menu']) }
    const target = await makeUser([0])
    await expect(updateUserRoles(target, [0, odd])).rejects.toThrow(/outside the catalog/)
    expect(await rolesOf(target)).toEqual([0])
  })

  it('lets a limited actor deactivate a normal user', async () => {
    const target = await makeUser([0])
    await setUserStatus(target, 1)
    expect(await statusOf(target)).toBe(1)
  })
})
