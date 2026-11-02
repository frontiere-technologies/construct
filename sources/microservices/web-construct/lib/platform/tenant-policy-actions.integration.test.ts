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
import { readTenantPolicyForPlatform } from './tenant-service'

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
