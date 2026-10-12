import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userRole, users } from '@/lib/db/schema'
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
const created: string[] = []

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

  it('lets a limited actor deactivate a normal user', async () => {
    const target = await makeUser([0])
    await setUserStatus(target, 1)
    expect(await statusOf(target)).toBe(1)
  })
})
