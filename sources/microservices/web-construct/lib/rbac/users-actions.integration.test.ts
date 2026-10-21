import { afterEach, beforeEach, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { withTenant, withGlobal } from '@/lib/db/tenant-db'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'

const created: string[] = []
let originalAdmins: Array<{ userId: string; status: number | null }> = []

describeIntegration('atomic last-active-administrator invariant', () => {
  async function expectLastAdminConflict(operation: Promise<unknown>) {
    try {
      await operation
      throw new Error('expected guarded mutation to fail')
    } catch (error) {
      const messages: string[] = []
      let current: unknown = error
      while (current && typeof current === 'object') {
        if ('message' in current) messages.push(String(current.message))
        current = 'cause' in current ? current.cause : undefined
      }
      expect(messages.join('\n')).toContain('last_active_administrator')
    }
  }

  beforeEach(async () => {
    originalAdmins = await withTenant(defaultTestTenant(), tx => tx.execute(sql`
      select distinct u.id as "userId", u.id_user_status as status
      from users u join user_role ur on ur.user_id = u.id
      where ur.id_role = 1
    `))
    await withTenant(defaultTestTenant(), tx => tx.execute(sql`
      update users set id_user_status = 1
      where id in (select user_id from user_role where id_role = 1)
    `))
  })

  afterEach(async () => {
    for (const row of originalAdmins) {
      await withGlobal(tx => tx.update(users).set({ idUserStatus: row.status }).where(eq(users.id, row.userId)))
    }
    for (const id of created.splice(0)) await withGlobal(tx => tx.delete(users).where(eq(users.id, id)))
  })

  async function admin() {
    const [user] = await withGlobal(tx => tx.insert(users).values({
      email: `zzz_admin_invariant_${unique()}@example.com`,
      authProvider: 'credentials',
      idUserStatus: 2,
    }).returning({ id: users.id }))
    created.push(user.id)
    await withTenant(defaultTestTenant(), async tx => {
      // I ruoli esistono solo con l'appartenenza al tenant (0048).
      await tx.insert(tenantMembership).values({ userId: user.id })
      await tx.insert(userRole).values([{ userId: user.id, idRole: 0 }, { userId: user.id, idRole: 1 }])
    })
    return user.id
  }

  it('rejects removal or deactivation of the only active administrator', async () => {
    const id = await admin()
    await expectLastAdminConflict(withTenant(defaultTestTenant(), tx => tx.execute(sql`select public.replace_user_roles_guarded(${id}, array[0]::bigint[])`)))
    await expectLastAdminConflict(withTenant(defaultTestTenant(), tx => tx.execute(sql`select public.set_membership_status_guarded(${id}, 'deactivated')`)))
  })

  it('serializes competing mutations so one active administrator remains', async () => {
    const first = await admin()
    const second = await admin()
    const results = await Promise.allSettled([
      withTenant(defaultTestTenant(), tx => tx.execute(sql`select public.replace_user_roles_guarded(${first}, array[0]::bigint[])`)),
      withTenant(defaultTestTenant(), tx => tx.execute(sql`select public.set_membership_status_guarded(${second}, 'deactivated')`)),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const [{ count }] = await withTenant(defaultTestTenant(), tx => tx.execute<{ count: string }>(sql`
      select count(distinct u.id)::text as count
      from users u join user_role ur on ur.user_id = u.id
      where u.id_user_status = 2 and ur.id_role = 1
    `))
    expect(count).toBe('1')
  })
})
