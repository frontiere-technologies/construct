import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture, type PolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { readTenantPolicy } from '@/lib/tenancy/tenant-policy-service'
import type { TenantPolicyDraft } from '@/lib/tenancy/tenant-policy-types'
import { grantSupportConsent } from '@/lib/tenancy/support-consent-actions'
import { closePlatform } from './db'
import { saveTenantPolicy, previewTenantGrantPurge, purgeTenantGrants } from './tenant-policy-actions'
import { readTenantPolicyForPlatform, readTenantUsageForPlatform } from './tenant-service'

const mocks = vi.hoisted(() => ({ session: null as unknown, failTenantAudit: false }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()), cache: <T>(fn: T) => fn,
}))
// Fault injection at the second journal; all other writes use the real database.
vi.mock('@/lib/audit/tenant-audit', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit/tenant-audit')>()
  return { ...actual, recordTenantAudit: async (...args: Parameters<typeof actual.recordTenantAudit>) => {
    if (mocks.failTenantAudit) throw new Error('second journal failed')
    return actual.recordTenantAudit(...args)
  } }
})

describeIntegration('platform tenant policy actions', () => {
  let fixture: PolicyFixture
  let cleanup: (() => Promise<void>) | undefined

  function signIn(userId = fixture.platformAdminId, tenantId: number | null = null) {
    mocks.session = { user: { id: userId, accountActive: true, tenantState: tenantId ? 'ready' : 'none', tenantId }, expires: '2099-01-01' }
  }

  async function draft(): Promise<TenantPolicyDraft> {
    const previous = await readTenantPolicy(fixture.tenantId)
    return { expectedRevision: previous.revision, areas: previous.areas, overrides: previous.overrides, limits: previous.limits }
  }

  async function audits() {
    return withOwner(async tx => {
      const platform = await tx.execute<{ operation: string; details: Record<string, unknown> }>(sql`
        select operation, details from public.platform_audit_event where id_tenant = ${fixture.tenantId} order by id`)
      const tenant = await tx.execute<{ operation: string; details: Record<string, unknown> }>(sql`
        select operation, details from public.tenant_audit_event order by id`)
      return { platform: [...platform], tenant: [...tenant] }
    }, fixture.tenantId)
  }

  async function seedGrants() {
    await withOwner(async tx => {
      // The copied template has grants of its own; isolate the selection to this test role.
      await tx.execute(sql`delete from public.role_permission`)
      await tx.execute(sql`delete from public.role_functionality`)
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${fixture.roleId}, id_permission from public.permission
        where code in ('read-users', 'read-roles', 'manage-tenant-settings', 'manage-support-consent')`)
      await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${fixture.roleId}, ${fixture.menuEntryId})`)
      await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${fixture.memberId}, ${fixture.roleId})`)
    }, fixture.tenantId)
  }

  async function grants() {
    return withTenant(fixture.tenantId, async tx => {
      const permissions = await tx.execute<{ code: string }>(sql`select p.code from public.role_permission rp
        join public.permission p using (id_permission) where rp.id_role = ${fixture.roleId} order by p.code`)
      const menus = await tx.execute<{ id: string }>(sql`select id_menu_entry::text as id from public.role_functionality where id_role = ${fixture.roleId} order by id_menu_entry`)
      const roles = await tx.execute(sql`select id_role from public.role where id_role = ${fixture.roleId}`)
      const entries = await tx.execute(sql`select id_menu_entry from public.menu_entry where id_menu_entry = ${fixture.menuEntryId}`)
      return { permissions: permissions.map(p => p.code), menus: menus.map(m => m.id), roles: roles.length, entries: entries.length }
    })
  }

  beforeEach(async () => {
    cleanup = undefined
    fixture = await createPolicyFixture('actions')
    cleanup = fixture.close
    vi.stubEnv('CONSTRUCT_PLATFORM_POLICY_WRITES', '1')
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
    mocks.failTenantAudit = false
    signIn()
  })
  afterEach(async () => { mocks.failTenantAudit = false; try { await cleanup?.() } finally { vi.unstubAllEnvs() } })
  afterAll(async () => { await closePlatform(); await closeOwner() })

  it('reads tenant-wide usage through a guarded platform port and rejects a tenant administrator', async () => {
    const usage = await readTenantUsageForPlatform(fixture.tenantId)
    const actual = await withTenant(fixture.tenantId, async tx => {
      const [row] = await tx.execute<{ members: number; roles: number; menuEntries: number }>(sql`select
        (select count(*)::int from public.tenant_membership) as members,
        (select count(*)::int from public.role) as roles,
        (select count(*)::int from public.menu_entry) as "menuEntries"`)
      return row
    })
    expect(usage).toEqual(actual)
    signIn(fixture.adminId, fixture.tenantId)
    await expect(readTenantUsageForPlatform(-1)).rejects.toThrow('Unauthorized')
  })

  it('rejects a second administrator saving from the same revision', async () => {
    const value = await draft()
    expect(await saveTenantPolicy(fixture.tenantId, value)).toEqual({ ok: true, revision: 2 })
    // Another real platform administrator, not the stale JWT attribute.
    await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = true where id = ${fixture.adminId}`))
    signIn(fixture.adminId)
    expect(await saveTenantPolicy(fixture.tenantId, value)).toEqual({ ok: false, reason: 'conflict' })
    expect((await audits()).platform).toHaveLength(1)
  })

  it('serializes concurrent saves and records structured differences in both journals', async () => {
    const value = await draft()
    value.areas.appearance = false
    value.overrides['manage-tenant-theme'] = false
    value.limits.maxMembers = 0
    const results = await Promise.all([saveTenantPolicy(fixture.tenantId, value), saveTenantPolicy(fixture.tenantId, value)])
    expect(results).toContainEqual({ ok: true, revision: 2 })
    expect(results).toContainEqual({ ok: false, reason: 'conflict' })
    const policy = await readTenantPolicyForPlatform(fixture.tenantId)
    expect(policy).toMatchObject({ revision: 2, areas: { appearance: false }, overrides: { 'manage-tenant-theme': false }, limits: { maxMembers: 0 } })
    const events = await audits()
    expect(events.platform).toEqual(events.tenant)
    expect(events.platform).toEqual([{ operation: 'tenant.policy.save', details: {
      revision: { from: 1, to: 2 },
      areas: { appearance: { from: true, to: false } },
      overrides: { 'manage-tenant-theme': { from: null, to: false } },
      limits: { maxMembers: { from: null, to: 0 } },
    } }])
  })

  it('rejects missing dependencies and malformed strict drafts without writes', async () => {
    const previous = await readTenantPolicy(fixture.tenantId)
    const value = await draft()
    value.overrides['read-users'] = false
    expect(await saveTenantPolicy(fixture.tenantId, value)).toEqual({ ok: false, reason: 'invalid' })
    for (const invalid of [
      { ...await draft(), extra: true },
      { ...await draft(), areas: { ...previous.areas, bogus: true } },
      { ...await draft(), overrides: { 'manage-support-consent': false } },
      { ...await draft(), limits: { ...previous.limits, extra: 1 } },
      { ...await draft(), limits: { ...previous.limits, queryTimeoutMs: 0 } },
      { ...await draft(), limits: { ...previous.limits, maxRoles: -1 } },
    ]) {
      expect(await saveTenantPolicy(fixture.tenantId, invalid)).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(await readTenantPolicy(fixture.tenantId)).toEqual(previous)
    expect(await audits()).toEqual({ platform: [], tenant: [] })
  })

  it('rolls back policy, revision and first journal when the second journal fails', async () => {
    const previous = await readTenantPolicy(fixture.tenantId)
    const value = await draft()
    value.areas.appearance = false
    value.limits.maxRoles = 0
    mocks.failTenantAudit = true
    await expect(saveTenantPolicy(fixture.tenantId, value)).rejects.toThrow('second journal failed')
    expect(await readTenantPolicy(fixture.tenantId)).toEqual(previous)
    expect(await audits()).toEqual({ platform: [], tenant: [] })
  })

  it.each([undefined, '0', 'true', '2'])('keeps writes disabled for %s while platform reads and previews stay available', async flag => {
    await seedGrants()
    const value = await draft()
    value.areas.appearance = false
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['manage-tenant-theme'])
    if (flag === undefined) delete process.env.CONSTRUCT_PLATFORM_POLICY_WRITES
    else process.env.CONSTRUCT_PLATFORM_POLICY_WRITES = flag
    const previous = await readTenantPolicyForPlatform(fixture.tenantId)
    const previousGrants = await grants()
    expect(await saveTenantPolicy(fixture.tenantId, await draft())).toEqual({ ok: false, reason: 'disabled' })
    expect(await purgeTenantGrants(fixture.tenantId, preview)).toEqual({ ok: false, reason: 'disabled' })
    expect(await previewTenantGrantPurge(fixture.tenantId, preview.keys)).toEqual(preview)
    expect(await readTenantPolicyForPlatform(fixture.tenantId)).toEqual(previous)
    expect(await grants()).toEqual(previousGrants)
  })

  it('requires platform authorization before validating any input or checking the release flag', async () => {
    mocks.session = null
    delete process.env.CONSTRUCT_PLATFORM_POLICY_WRITES
    await expect(saveTenantPolicy(-1, await draft())).rejects.toThrow('Unauthorized')
    await expect(previewTenantGrantPurge(-1, [])).rejects.toThrow('Unauthorized')
    await expect(purgeTenantGrants(-1, { revision: 0, keys: [], roleCount: 0, permissionGrantCount: 0, menuGrantCount: 0, fingerprint: '' })).rejects.toThrow('Unauthorized')
    await expect(readTenantPolicyForPlatform(-1)).rejects.toThrow('Unauthorized')
  })

  it('purges only suspended selected grants, preserving roles, menus, live grants and delegated consent', async () => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    value.areas['tenant-settings'] = false
    expect((await saveTenantPolicy(fixture.tenantId, value)).ok).toBe(true)
    const previous = await grants()
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users', 'manage-tenant-settings'])
    expect(preview).toMatchObject({ revision: 2, keys: ['read-users', 'manage-tenant-settings'], roleCount: 1, permissionGrantCount: 2, menuGrantCount: 1 })
    expect(await purgeTenantGrants(fixture.tenantId, preview)).toEqual({ ok: true, revision: 3 })
    expect(await grants()).toEqual({ permissions: ['manage-support-consent', 'read-roles'], menus: [], roles: previous.roles, entries: previous.entries })
    const events = await audits()
    expect(events.platform).toEqual(events.tenant)
    expect(events.platform.at(-1)).toMatchObject({ operation: 'tenant.grants.purge', details: { keys: preview.keys, permissionGrantCount: 2, menuGrantCount: 1 } })
    signIn(fixture.memberId, fixture.tenantId)
    expect((await grantSupportConsent('1h')).ok).toBe(true)
  })

  it('refuses essential and still granted features hidden in the selected keys', async () => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const previous = await grants()
    for (const key of ['read-roles', 'manage-support-consent'] as const) {
      await expect(previewTenantGrantPurge(fixture.tenantId, ['read-users', key])).rejects.toThrow()
      expect(await purgeTenantGrants(fixture.tenantId, { ...preview, keys: [...preview.keys, key] })).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(await grants()).toEqual(previous)
  })

  it('preserves area categories, essential menu grants and an explicit live override', async () => {
    await seedGrants()
    const entries = await withOwner(async tx => {
      const [category] = await tx.execute<{ id: number }>(sql`insert into public.menu_entry
        (name, area_key, order_position, is_immutable) values ('category', 'people', 0, 0) returning id_menu_entry::int as id`)
      const [essential] = await tx.execute<{ id: number }>(sql`insert into public.menu_entry
        (name, id_functionality_type, functionality_link, order_position, is_immutable)
        values ('consent', 3, '/admin/tenant-settings', 0, 0) returning id_menu_entry::int as id`)
      // Categories can only have historical grants; the normal T04 path refuses new ones.
      await tx.execute(sql`select set_config('app.copy_suspended_grants', 'on', true)`)
      await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry)
        values (${fixture.roleId}, ${category.id}), (${fixture.roleId}, ${essential.id})`)
      await tx.execute(sql`select set_config('app.copy_suspended_grants', 'off', true)`)
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${fixture.roleId}, id_permission from public.permission where code = 'set-user-status'`)
      return { category: category.id, essential: essential.id }
    }, fixture.tenantId)
    const value = await draft()
    value.areas.people = false
    value.overrides['read-users'] = true
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['set-user-status'])
    expect(preview).toMatchObject({ permissionGrantCount: 1, menuGrantCount: 0 })
    expect((await purgeTenantGrants(fixture.tenantId, preview)).ok).toBe(true)
    const remaining = await grants()
    expect(remaining.permissions).toContain('read-users')
    expect(remaining.permissions).not.toContain('set-user-status')
    expect(remaining.menus).toEqual([fixture.menuEntryId, entries.category, entries.essential].sort((a, b) => a - b).map(String))
  })

  it('serializes purge confirmations, rejects invalid keys and conflicts after a newer policy', async () => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    await saveTenantPolicy(fixture.tenantId, value)
    for (const keys of [[], ['read-users', 'read-users'], ['unknown']]) {
      await expect(previewTenantGrantPurge(fixture.tenantId, keys as Parameters<typeof previewTenantGrantPurge>[1])).rejects.toThrow()
    }
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const results = await Promise.all([purgeTenantGrants(fixture.tenantId, preview), purgeTenantGrants(fixture.tenantId, preview)])
    expect(results).toContainEqual({ ok: true, revision: 3 })
    expect(results).toContainEqual({ ok: false, reason: 'conflict' })
    const stale = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const newer = await draft()
    newer.areas.people = true
    await saveTenantPolicy(fixture.tenantId, newer)
    expect(await purgeTenantGrants(fixture.tenantId, stale)).toEqual({ ok: false, reason: 'conflict' })
  })

  it.each([
    ['permission', 'direct'], ['permission', 'delta'], ['menu', 'direct'], ['menu', 'delta'],
  ] as const)('rejects a preview overtaken by a runtime %s revocation through %s SQL', async (kind, path) => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const previous = await grants()
    const previousAudits = await audits()
    let release!: () => void
    let revoked!: (pid: number) => void
    const held = new Promise<void>(resolve => { release = resolve })
    const revocationReady = new Promise<number>(resolve => { revoked = resolve })
    const revocation = withTenant(fixture.tenantId, async tx => {
      const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
      const [{ id }] = await tx.execute<{ id: string }>(sql`select id_permission::text as id from public.permission where code = 'read-users'`)
      if (kind === 'permission') {
        if (path === 'direct') await tx.execute(sql`delete from public.role_permission where id_role = ${fixture.roleId} and id_permission = ${id}::bigint`)
        else await tx.execute(sql`select public.apply_role_permission_deltas(${fixture.roleId}::bigint, '{}'::bigint[], array[${id}::bigint])`)
      } else {
        if (path === 'direct') await tx.execute(sql`delete from public.role_functionality where id_role = ${fixture.roleId} and id_menu_entry = ${fixture.menuEntryId}`)
        else await tx.execute(sql`select public.apply_role_functionality_deltas(${fixture.roleId}::bigint, '{}'::bigint[], array[${fixture.menuEntryId}::bigint])`)
      }
      revoked(pid)
      await held
    })
    let confirmation: ReturnType<typeof purgeTenantGrants> | undefined
    try {
      const revokerPid = await Promise.race([revocationReady, revocation.then(() => { throw new Error('revocation barrier was not reached') })])
      // Ordinary previews must stay nonblocking while a SQL revocation owns the row lock.
      expect(await previewTenantGrantPurge(fixture.tenantId, ['read-users'])).toEqual(preview)
      confirmation = purgeTenantGrants(fixture.tenantId, preview)
      // This observes a real database wait, rather than guessing which query ran after a sleep.
      await vi.waitFor(async () => {
        const [{ waiting }] = await withOwner(tx => tx.execute<{ waiting: boolean }>(sql`
          select exists(select 1 from pg_catalog.pg_stat_activity a
            where ${revokerPid} = any(pg_catalog.pg_blocking_pids(a.pid))) as waiting`))
        expect(waiting).toBe(true)
      })
      release()
      await revocation
      expect(await confirmation).toEqual({ ok: false, reason: 'conflict' })
      expect(await grants()).toEqual({
        ...previous,
        ...(kind === 'permission' ? { permissions: previous.permissions.filter(code => code !== 'read-users') } : { menus: [] }),
      })
      expect((await readTenantPolicy(fixture.tenantId)).revision).toBe(2)
      expect(await audits()).toEqual(previousAudits)
    } finally {
      release()
      await Promise.allSettled([revocation, ...(confirmation ? [confirmation] : [])])
    }
  })

  it.each([
    ['role_permission', 'id_permission', 'apply_role_permission_deltas'],
    ['role_functionality', 'id_menu_entry', 'apply_role_functionality_deltas'],
  ] as const)('does not deadlock when purge follows a %s delta paused after DELETE', async (table, key, delta) => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    expect(await saveTenantPolicy(fixture.tenantId, value)).toEqual({ ok: true, revision: 2 })
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const before = await grants()
    const beforeAudits = await audits()
    const targetTable = sql`public.${sql.identifier(table)}`
    // The two-argument key has a separate namespace from the production policy lock.
    const barrier = sql`(7313, pg_catalog.pg_backend_pid())`
    await withOwner(async tx => {
      await tx.execute(sql`create function app_private.test_pause_delta_delete() returns trigger
        language plpgsql set search_path = '' as $$
        declare holder integer := nullif(current_setting('app.test_delta_barrier', true), '')::integer;
        begin
          if holder is not null then perform pg_catalog.pg_advisory_xact_lock(7313, holder); end if;
          return null;
        end $$`)
      await tx.execute(sql`create trigger test_pause_delta_delete after delete on ${targetTable}
        for each row execute function app_private.test_pause_delta_delete()`)
    })
    let revocation: Promise<unknown> | undefined
    let confirmation: ReturnType<typeof purgeTenantGrants> | undefined
    try {
      await withOwner(async holder => {
        const [{ pid: holderPid }] = await holder.execute<{ pid: number }>(sql`select pg_catalog.pg_backend_pid() as pid`)
        await holder.execute(sql`select pg_catalog.pg_advisory_xact_lock${barrier}`)
        let identify!: (pid: number) => void
        const revoker = new Promise<number>(resolve => { identify = resolve })
        revocation = withTenant(fixture.tenantId, async tx => {
          const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_catalog.pg_backend_pid() as pid`)
          const [{ id }] = await tx.execute<{ id: string }>(sql`
            select ${sql.identifier(key)}::text as id from ${targetTable} where id_role = ${fixture.roleId}
              and ${sql.identifier(key)} = ${table === 'role_permission'
                ? sql`(select id_permission from public.permission where code = 'read-users')`
                : sql`${fixture.menuEntryId}::bigint`}`)
          await tx.execute(sql`select set_config('app.test_delta_barrier', ${String(holderPid)}, true)`)
          identify(pid)
          await tx.execute(sql`select public.${sql.identifier(delta)}(${fixture.roleId}::bigint, '{}'::bigint[], array[${id}::bigint])`)
        })
        const revokerPid = await Promise.race([revoker, revocation.then(() => { throw new Error('delta did not reach the barrier') })])
        await vi.waitFor(async () => {
          const [{ waiting }] = await holder.execute<{ waiting: boolean }>(sql`
            select ${holderPid} = any(pg_catalog.pg_blocking_pids(${revokerPid})) as waiting`)
          expect(waiting).toBe(true)
        }, { timeout: 2500 })
        // In 0072 the purge reaches the grant's row lock. With the repair it waits
        // earlier on the same revoker, at the policy lock. Either wait is observable.
        confirmation = purgeTenantGrants(fixture.tenantId, preview)
        void confirmation.catch(() => undefined)
        await vi.waitFor(async () => {
          const [{ waiting }] = await holder.execute<{ waiting: boolean }>(sql`
            select exists(select 1 from pg_catalog.pg_stat_activity a
              where ${revokerPid} = any(pg_catalog.pg_blocking_pids(a.pid))) as waiting`)
          expect(waiting).toBe(true)
        }, { timeout: 2500 })
      })
      const results = await Promise.allSettled([revocation, confirmation])
      for (const result of results) {
        if (result.status === 'rejected') throw (result.reason as Error).cause ?? result.reason
      }
      expect(await confirmation).toEqual({ ok: false, reason: 'conflict' })
      expect(await grants()).toEqual({
        ...before,
        ...(table === 'role_permission' ? { permissions: before.permissions.filter(code => code !== 'read-users') } : { menus: [] }),
      })
      expect((await readTenantPolicy(fixture.tenantId)).revision).toBe(2)
      expect(await audits()).toEqual(beforeAudits)
    } finally {
      await Promise.allSettled([revocation, confirmation])
      await withOwner(tx => tx.execute(sql`drop function app_private.test_pause_delta_delete() cascade`))
    }
  }, 12_000)

  it('rejects stale fingerprints even when counts match and accepts canonical menu aliases', async () => {
    await seedGrants()
    const [alias] = await withOwner(tx => tx.execute<{ id: number }>(sql`insert into public.menu_entry
      (name, id_functionality_type, functionality_link, canonical_link, order_position, is_immutable)
      values ('alias', 3, '/user-management?alias=1', '/user-management?alias=1', 0, 0) returning id_menu_entry::int as id`), fixture.tenantId)
    const value = await draft()
    value.areas.people = false
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    await withOwner(async tx => {
      await tx.execute(sql`delete from public.role_functionality where id_role = ${fixture.roleId} and id_menu_entry = ${fixture.menuEntryId}`)
      // Simulate a historical replacement without changing the revision: T04 forbids new disabled grants.
      await tx.execute(sql`select set_config('app.copy_suspended_grants', 'on', true)`)
      await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${fixture.roleId}, ${alias.id})`)
    }, fixture.tenantId)
    const refreshed = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    expect(refreshed.permissionGrantCount).toBe(preview.permissionGrantCount)
    expect(refreshed.menuGrantCount).toBe(preview.menuGrantCount)
    expect(refreshed.fingerprint).not.toBe(preview.fingerprint)
    expect(await purgeTenantGrants(fixture.tenantId, preview)).toEqual({ ok: false, reason: 'conflict' })
    expect(await purgeTenantGrants(fixture.tenantId, refreshed)).toEqual({ ok: true, revision: 3 })
    expect((await grants()).menus).toEqual([])
  })

  it('rolls back purge and both journals on second-journal failure and rejects tampered previews', async () => {
    await seedGrants()
    const value = await draft()
    value.areas.people = false
    await saveTenantPolicy(fixture.tenantId, value)
    const preview = await previewTenantGrantPurge(fixture.tenantId, ['read-users'])
    const previous = await grants()
    const previousAudits = await audits()
    expect(await purgeTenantGrants(fixture.tenantId, { ...preview, menuGrantCount: 99 })).toEqual({ ok: false, reason: 'conflict' })
    expect(await purgeTenantGrants(fixture.tenantId, { ...preview, extra: true } as typeof preview)).toEqual({ ok: false, reason: 'invalid' })
    mocks.failTenantAudit = true
    await expect(purgeTenantGrants(fixture.tenantId, preview)).rejects.toThrow('second journal failed')
    expect(await grants()).toEqual(previous)
    expect(await audits()).toEqual(previousAudits)
    expect((await readTenantPolicy(fixture.tenantId)).revision).toBe(2)
  })
})
