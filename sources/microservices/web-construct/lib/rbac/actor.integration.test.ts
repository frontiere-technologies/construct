import { afterAll, afterEach, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { permission, role, rolePermission, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from './types'
import { resolveActor } from './actor'

const PREFIX = 'zzz_actor_'
const ROLE_TYPE_SERVICE = 2

async function readerOf(code: string, status = USER_STATUS_ACTIVE): Promise<{ userId: string; idRole: number }> {
  return withTenant(defaultTestTenant(), async tx => {
    const [user] = await tx.insert(users)
      .values({ email: `${PREFIX}${unique()}@example.test`, idUserStatus: status })
      .returning({ id: users.id })
    const [created] = await tx.insert(role)
      .values({ description: `${PREFIX}${unique()}`, idRoleType: ROLE_TYPE_SERVICE })
      .returning({ idRole: role.idRole })
    const [perm] = await tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, code))
    // I ruoli esistono solo con l'appartenenza al tenant (0048).
    await tx.insert(tenantMembership).values({ userId: user.id })
    await tx.insert(userRole).values({ userId: user.id, idRole: created.idRole })
    await tx.insert(rolePermission).values({ idRole: created.idRole, idPermission: perm.idPermission })
    return { userId: user.id, idRole: created.idRole }
  })
}

afterEach(async () => {
  // `permission` è in sola lettura per l'app (0047): le scritture dei fixture passano dal proprietario.
  await withOwner(tx => tx.update(permission).set({ deprecatedAt: null }).where(eq(permission.code, 'read-menu')))
  await withTenant(defaultTestTenant(), async tx => {
    await tx.delete(users).where(like(users.email, `${PREFIX}%`))
    await tx.delete(role).where(like(role.description, `${PREFIX}%`))
  })
})

afterAll(closeOwner)

describeIntegration('resolveActor', () => {
  it('reads the codes the user roles grant', async () => {
    const { userId } = await readerOf('read-menu')
    const actor = await resolveActor(defaultTestTenant(), userId)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
    expect(actor?.tenantId).toBe(defaultTestTenant())
  })

  it('does not count a deprecated permission, even while the grant row still exists', async () => {
    const { userId } = await readerOf('read-menu')
    await withOwner(tx => tx.update(permission).set({ deprecatedAt: new Date().toISOString() }).where(eq(permission.code, 'read-menu')))
    const actor = await resolveActor(defaultTestTenant(), userId)
    expect(actor && [...actor.permissions]).toEqual([])
  })

  it('returns no actor for a deactivated account', async () => {
    const { userId } = await readerOf('read-menu', USER_STATUS_DEACTIVATED)
    expect(await resolveActor(defaultTestTenant(), userId)).toBeNull()
  })
})
