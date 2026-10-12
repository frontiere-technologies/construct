import { afterEach, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, role, rolePermission, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from './types'
import { resolveActor } from './actor'

const PREFIX = 'zzz_actor_'
const ROLE_TYPE_SERVICE = 2

async function readerOf(code: string, status = USER_STATUS_ACTIVE): Promise<{ userId: string; idRole: number }> {
  const [user] = await db.insert(users)
    .values({ email: `${PREFIX}${unique()}@example.test`, idUserStatus: status })
    .returning({ id: users.id })
  const [created] = await db.insert(role)
    .values({ description: `${PREFIX}${unique()}`, idRoleType: ROLE_TYPE_SERVICE })
    .returning({ idRole: role.idRole })
  const [perm] = await db.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, code))
  await db.insert(userRole).values({ userId: user.id, idRole: created.idRole })
  await db.insert(rolePermission).values({ idRole: created.idRole, idPermission: perm.idPermission })
  return { userId: user.id, idRole: created.idRole }
}

afterEach(async () => {
  await db.update(permission).set({ deprecatedAt: null }).where(eq(permission.code, 'read-menu'))
  await db.delete(users).where(like(users.email, `${PREFIX}%`))
  await db.delete(role).where(like(role.description, `${PREFIX}%`))
})

describeIntegration('resolveActor', () => {
  it('reads the codes the user roles grant', async () => {
    const { userId } = await readerOf('read-menu')
    const actor = await resolveActor(userId)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('does not count a deprecated permission, even while the grant row still exists', async () => {
    const { userId } = await readerOf('read-menu')
    await db.update(permission).set({ deprecatedAt: new Date().toISOString() }).where(eq(permission.code, 'read-menu'))
    const actor = await resolveActor(userId)
    expect(actor && [...actor.permissions]).toEqual([])
  })

  it('returns no actor for a deactivated account', async () => {
    const { userId } = await readerOf('read-menu', USER_STATUS_DEACTIVATED)
    expect(await resolveActor(userId)).toBeNull()
  })
})
