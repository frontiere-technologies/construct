import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture } from './policy-test-fixture'
import { addTenantMember } from './membership'
import { tenantIdForTest } from './testing'
import { selectTenantUsage } from './tenant-limits'

// Independent SQL control for the shared usage selector and quota assertions.
async function usage(tenantId: Parameters<typeof withTenant>[0]) {
  const [row] = await withTenant(tenantId, tx => tx.execute<{ members: number; roles: number; menuEntries: number }>(sql`
    select (select count(*)::int from public.tenant_membership) as members,
      (select count(*)::int from public.role) as roles,
      (select count(*)::int from public.menu_entry) as "menuEntries"`))
  return row
}

describeIntegration('tenant resource quotas', () => {
  afterAll(closeOwner)

  it.each(['roles', 'members', 'menuEntries'] as const)('serializes two requests for the last %s slot, including a stale snapshot before the lock', async resource => {
    const f = await createPolicyFixture('quota-race')
    let extraId: string | undefined
    try {
      const before = await usage(f.tenantId)
      expect(await withTenant(f.tenantId, selectTenantUsage)).toEqual(before)
      if (resource === 'members') {
        const [user] = await withOwner(tx => tx.execute<{ id: string }>(sql`insert into public.users (email)
          values (${`zzz-quota-race-${unique()}@example.test`}) returning id::text`))
        extraId = user.id
      }
      const column = { roles: 'max_roles', members: 'max_members', menuEntries: 'max_menu_entries' }[resource]
      const error = { roles: 'tenant_role_quota', members: 'tenant_member_quota', menuEntries: 'tenant_menu_quota' }[resource]
      const insert = (first: boolean) => resource === 'roles'
        ? sql`insert into public.role (id_role_type, description) values (2, ${first ? 'first' : 'second'})`
        : resource === 'menuEntries'
          ? sql`insert into public.menu_entry (name, order_position) values (${first ? 'first' : 'second'}, 0)`
          : sql`insert into public.tenant_membership (user_id) values (${first ? f.platformAdminId : extraId}::uuid)`
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set ${sql.identifier(column)} = ${before[resource] + 1}`), f.tenantId)
      let release!: () => void
      let ready!: () => void
      const locked = new Promise<void>(resolve => { ready = resolve })
      const held = new Promise<void>(resolve => { release = resolve })
      const first = withTenant(f.tenantId, async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`)
        await tx.execute(insert(true))
        ready()
        await held
      })
      await Promise.race([locked, first])
      const second = withTenant(f.tenantId, async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`)
        await tx.execute(sql`select count(*) from public.role`)
        await tx.execute(insert(false))
      })
      const outcomes = Promise.allSettled([first, second])
      let waited = false
      try {
        const deadline = Date.now() + 1000
        while (Date.now() < deadline) {
          const [locks] = await withOwner(tx => tx.execute<{ waiting: boolean }>(sql`select exists (
            select 1 from pg_catalog.pg_locks where locktype = 'advisory' and not granted
              and classid::bigint = 4294967295 and objid::bigint = 4294967296 - ${f.tenantId}
          ) as waiting`))
          if (locks.waiting) { waited = true; break }
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      } finally { release() }
      const results = await outcomes
      expect(waited, 'the second insert never waited on the policy lock').toBe(true)
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ cause: expect.objectContaining({ message: error }) }) }),
      ])
      expect((await usage(f.tenantId))[resource]).toBe(before[resource] + 1)
    } finally {
      await f.close()
      if (extraId !== undefined) await withOwner(tx => tx.execute(sql`delete from public.users where id = ${extraId}::uuid`))
    }
  })

  it('counts deactivated memberships and allows existing-member invitations and reactivation at zero', async () => {
    const f = await createPolicyFixture('quota-member')
    try {
      await withTenant(f.tenantId, tx => tx.execute(sql`select public.set_membership_status_guarded(${f.memberId}::uuid, 'deactivated')`))
      expect((await usage(f.tenantId)).members).toBe(2)
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_members = 2`), f.tenantId)
      await expect(withTenant(f.tenantId, tx => addTenantMember(tx, f.platformAdminId))).rejects.toMatchObject({ cause: { message: 'tenant_member_quota' } })
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_members = 0`), f.tenantId)
      await expect(withTenant(f.tenantId, tx => addTenantMember(tx, f.memberId))).resolves.toBe(false)
      await withOwner(tx => tx.execute(sql`select 1 from app_private.register_tenant_admin(
        (select email from public.users where id = ${f.adminId}::uuid))`), f.tenantId)
      await withTenant(f.tenantId, tx => tx.execute(sql`select public.set_membership_status_guarded(${f.memberId}::uuid, 'active')`))
      expect((await usage(f.tenantId)).members).toBe(2)
    } finally { await f.close() }
  })

  it('checks the whole insert batch and does not charge ON CONFLICT rows at a lowered quota', async () => {
    const f = await createPolicyFixture('quota-batch')
    try {
      const before = await usage(f.tenantId)
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_roles = ${before.roles + 1}`), f.tenantId)
      await expect(withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role (id_role_type, description)
        values (2, 'batch first'), (2, 'batch second')`))).rejects.toMatchObject({ cause: { message: 'tenant_role_quota' } })
      expect(await usage(f.tenantId)).toEqual(before)
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_roles = 0`), f.tenantId)
      await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role (id_role, id_role_type, description)
        values (${f.roleId}, 2, 'ignored') on conflict do nothing`))
      expect(await usage(f.tenantId)).toEqual(before)
    } finally { await f.close() }
  })

  it('keeps all resources when limits are lowered below usage; zero stops only new roles and categories', async () => {
    const f = await createPolicyFixture('quota-zero')
    try {
      const before = await usage(f.tenantId)
      const [systems] = await withTenant(f.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count from public.role where system_key is not null`))
      expect(systems.count).toBe(2)
      await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.menu_entry (name, order_position) values ('category', 0)`))
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_roles = 0, max_menu_entries = 0`), f.tenantId)
      expect(await usage(f.tenantId)).toEqual({ ...before, menuEntries: before.menuEntries + 1 })
      await expect(withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role (id_role_type, description) values (2, 'blocked')`)))
        .rejects.toMatchObject({ cause: { message: 'tenant_role_quota' } })
      await expect(withTenant(f.tenantId, tx => tx.execute(sql`insert into public.menu_entry (name, order_position) values ('blocked category', 0)`)))
        .rejects.toMatchObject({ cause: { message: 'tenant_menu_quota' } })
      await withTenant(f.tenantId, tx => tx.execute(sql`update public.menu_entry set order_position = order_position + 1 where id_menu_entry = ${f.menuEntryId}`))
      expect(await usage(f.tenantId)).toEqual({ ...before, menuEntries: before.menuEntries + 1 })
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_roles = null, max_menu_entries = null, max_members = null`), f.tenantId)
      await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role (id_role_type, description) values (2, 'unlimited')`))
    } finally { await f.close() }
  })

  it.each(['repeatable read', 'serializable'] as const)('refuses counted writes under %s with a specific error', async isolationLevel => {
    const f = await createPolicyFixture('quota-isolate')
    try {
      await withTenant(f.tenantId, async holder => {
        await holder.execute(sql`select app_private.lock_tenant_policy()`)
        await expect(withTenant(f.tenantId, async tx => {
          await tx.execute(sql`set local lock_timeout = '200ms'`)
          await tx.execute(sql`select count(*) from public.role`)
          await tx.execute(sql`insert into public.role (id_role_type, description) values (2, 'unsafe snapshot')`)
        }, { isolationLevel })).rejects.toMatchObject({ cause: { message: 'tenant_quota_requires_read_committed' } })
      })
    } finally { await f.close() }
  })

  it('rolls back the entire copy when source limits cannot hold its roles or categories', async () => {
    const f = await createPolicyFixture('quota-copy')
    try {
      for (const column of ['max_roles', 'max_menu_entries'] as const) {
        await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set max_roles = ${column === 'max_roles' ? 0 : null}, max_menu_entries = ${column === 'max_menu_entries' ? 0 : null}`), f.tenantId)
        const slug = `zzz-quota-copy-${unique()}`
        let unexpectedId: number | undefined
        try {
          await expect(withOwner(async tx => {
            const [row] = await tx.execute<{ id: string }>(sql`select app_private.copy_tenant(${f.tenantId}, ${slug}, 'quota copy', false)::text as id`)
            unexpectedId = Number(row.id)
          })).rejects.toMatchObject({ cause: { message: column === 'max_roles' ? 'tenant_role_quota' : 'tenant_menu_quota' } })
          const [remaining] = await withOwner(tx => tx.execute<{ count: number }>(sql`select count(*)::int as count from public.tenant where slug = ${slug}`))
          expect(remaining.count).toBe(0)
        } finally { if (unexpectedId !== undefined) await deleteTenantForTest(tenantIdForTest(unexpectedId)) }
      }
    } finally { await f.close() }
  })
})
