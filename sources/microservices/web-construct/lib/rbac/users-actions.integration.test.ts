import { afterEach, beforeEach, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userRole, users } from '@/lib/db/schema'
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
    originalAdmins = await db.execute(sql`
      select distinct u.id as "userId", u.id_user_status as status
      from users u join user_role ur on ur.user_id = u.id
      where ur.id_role = 1
    `)
    await db.execute(sql`
      update users set id_user_status = 1
      where id in (select user_id from user_role where id_role = 1)
    `)
  })

  afterEach(async () => {
    for (const row of originalAdmins) {
      await db.update(users).set({ idUserStatus: row.status }).where(eq(users.id, row.userId))
    }
    for (const id of created.splice(0)) await db.delete(users).where(eq(users.id, id))
  })

  async function admin() {
    const [user] = await db.insert(users).values({
      email: `zzz_admin_invariant_${unique()}@example.com`,
      authProvider: 'credentials',
      idUserStatus: 2,
    }).returning({ id: users.id })
    created.push(user.id)
    await db.insert(userRole).values([{ userId: user.id, idRole: 0 }, { userId: user.id, idRole: 1 }])
    return user.id
  }

  it('rejects removal or deactivation of the only active administrator', async () => {
    const id = await admin()
    await expectLastAdminConflict(db.execute(sql`select public.replace_user_roles_guarded(${id}, array[0]::bigint[])`))
    await expectLastAdminConflict(db.execute(sql`select public.set_user_status_guarded(${id}, 1)`))
  })

  it('serializes competing mutations so one active administrator remains', async () => {
    const first = await admin()
    const second = await admin()
    const results = await Promise.allSettled([
      db.execute(sql`select public.replace_user_roles_guarded(${first}, array[0]::bigint[])`),
      db.execute(sql`select public.set_user_status_guarded(${second}, 1)`),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const [{ count }] = await db.execute<{ count: string }>(sql`
      select count(distinct u.id)::text as count
      from users u join user_role ur on ur.user_id = u.id
      where u.id_user_status = 2 and ur.id_role = 1
    `)
    expect(count).toBe('1')
  })
})
