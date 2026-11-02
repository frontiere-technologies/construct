import { NextRequest } from 'next/server'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor, resolveSupportActor } from '@/lib/rbac/actor'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { tenantIdForTest } from './testing'
import { createPolicyFixture, type PolicyFixture } from './policy-test-fixture'

const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => session }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT') }, notFound: () => { throw new Error('NOT_FOUND') } }))

async function disable(fixture: PolicyFixture, areas: string[]) {
  await withOwner(tx => tx.execute(sql`update public.tenant_area_entitlement set enabled = false
    where area_code = any(${`{${areas.join(',')}}`}::text[])`), fixture.tenantId)
}

async function grantReadUsers(fixture: PolicyFixture) {
  await withTenant(fixture.tenantId, async tx => {
    await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
      select ${fixture.roleId}, p.id_permission from public.permission p where p.code = 'read-users'`)
    await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${fixture.roleId}, ${fixture.menuEntryId})`)
    await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${fixture.memberId}, ${fixture.roleId})`)
  })
}

describeIntegration('tenant feature enforcement', () => {
  beforeEach(() => { session.user = {} })
  afterAll(closeOwner)

  it.each(['person', 'administrator', 'support'] as const)('immediately applies the feature ceiling to %s', async kind => {
    const f = await createPolicyFixture(`ceiling-${kind}`)
    try {
      await grantReadUsers(f)
      if (kind === 'support') await withOwner(async tx => {
        await tx.execute(sql`update public.tenant_settings set support_until = now() + interval '1 hour', support_granted_at = now() - interval '1 minute'`)
        await tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, object_type, object_id, details)
          values (${f.platformAdminId}, 'platform', 'support.enter', 'tenant', ${String(f.tenantId)}, '{"reason":"ceiling test"}')`)
      }, f.tenantId)
      const userId = kind === 'person' ? f.memberId : kind === 'support' ? f.platformAdminId : f.adminId
      session.user = { id: userId, tenantState: kind === 'support' ? 'support' : 'ready', tenantId: f.tenantId }
      await expect(requirePermission('read-users')).resolves.toMatchObject({ userId })
      await disable(f, ['people', 'appearance', 'tenant-settings'])
      await expect(requirePermission('read-users')).rejects.toThrow('Unauthorized')
      const { POST } = await import('@/app/api/rbac/users-grid/route')
      const response = await POST(new NextRequest('http://localhost:3000/api/rbac/users-grid', { method: 'POST', body: '{}' }))
      expect(response.status).toBe(403)
      const actor = kind === 'support' ? await resolveSupportActor(f.tenantId, userId) : await resolveActor(f.tenantId, userId)
      expect(actor?.features.has('manage-tenant-theme')).toBe(false)
      expect(actor?.permissions.has('read-users')).toBe(false)
      if (kind === 'administrator') expect(actor?.canManageSupportConsent).toBe(true)
      if (kind === 'support') expect(actor?.canManageSupportConsent).toBe(false)
    } finally { await f.close() }
  })

  it('preserves suspended grants, rejects new direct SQL grants and allows revocation and reactivation', async () => {
    const f = await createPolicyFixture('sql-guards')
    try {
      await grantReadUsers(f)
      await grantCodes(f, ['read-menu'])
      await disable(f, ['people'])
      for (const operation of [
        sql`insert into public.role_permission (id_role, id_permission) select ${f.roleId}, p.id_permission from public.permission p where p.code = 'invite-users'`,
        sql`insert into public.role_functionality (id_role, id_menu_entry)
          select r.id_role, ${f.menuEntryId} from public.role r where r.system_key = 'REGISTERED'`,
        sql`update public.role_permission set id_permission = (select id_permission from public.permission where code = 'invite-users')
          where id_role = ${f.roleId} and id_permission = (select id_permission from public.permission where code = 'read-menu')`,
        sql`update public.role_functionality set id_role = (select id_role from public.role where system_key = 'REGISTERED') where id_role = ${f.roleId}`,
      ]) await expect(withTenant(f.tenantId, tx => tx.execute(operation))).rejects.toMatchObject({ cause: { message: expect.stringContaining('tenant_feature_disabled') } })
      const [counts] = await withTenant(f.tenantId, tx => tx.execute<{ permissions: number; menu: number }>(sql`
        select (select count(*)::int from public.role_permission where id_role = ${f.roleId}) as permissions,
          (select count(*)::int from public.role_functionality where id_role = ${f.roleId}) as menu`))
      expect(counts).toEqual({ permissions: 2, menu: 1 })
      await withTenant(f.tenantId, tx => tx.execute(sql`delete from public.role_functionality where id_role = ${f.roleId}`))
      await withOwner(tx => tx.execute(sql`update public.tenant_area_entitlement set enabled = true where area_code = 'people'`), f.tenantId)
      expect((await resolveActor(f.tenantId, f.memberId))?.permissions.has('read-users')).toBe(true)
    } finally { await f.close() }
  })
})

async function grantCodes(f: PolicyFixture, codes: string[]) {
  await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role_permission (id_role, id_permission)
    select ${f.roleId}, p.id_permission from public.permission p where p.code = any(${`{${codes.join(',')}}`}::text[])
    on conflict do nothing`))
}

it('keeps essential consent separate from new optional grants, suspended areas and optional purge', async () => {
  const { grantSupportConsent, revokeSupportConsent } = await import('./support-consent-actions')
  const { requireTenantSettingsPage } = await import('@/lib/rbac/auth-guard')
  const f = await createPolicyFixture('consent')
  try {
    await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.user_role (user_id, id_role) values (${f.memberId}, ${f.roleId})`))
    session.user = { id: f.memberId, tenantState: 'ready', tenantId: f.tenantId }
    await grantCodes(f, ['manage-tenant-settings'])
    await expect(requireTenantSettingsPage()).resolves.toMatchObject({ canManageSupportConsent: false })
    await expect(grantSupportConsent('1h')).rejects.toThrow('Unauthorized')
    await grantCodes(f, ['manage-support-consent'])
    await disable(f, ['tenant-settings'])
    await expect(requirePermission('manage-tenant-settings')).rejects.toThrow('Unauthorized')
    await expect(grantSupportConsent('1h')).resolves.toMatchObject({ ok: true })
    await withTenant(f.tenantId, tx => tx.execute(sql`delete from public.role_permission rp using public.permission p
      where p.id_permission = rp.id_permission and rp.id_role = ${f.roleId} and p.code = 'manage-tenant-settings'`))
    await expect(revokeSupportConsent()).resolves.toEqual({ ok: true })
    await expect(grantSupportConsent('1h')).resolves.toMatchObject({ ok: true })
    await withTenant(f.tenantId, tx => tx.execute(sql`delete from public.role_permission rp using public.permission p
      where p.id_permission = rp.id_permission and rp.id_role = ${f.roleId} and p.code = 'manage-support-consent'`))
    await expect(revokeSupportConsent()).rejects.toThrow('Unauthorized')
  } finally { await f.close() }
})

it('rejects direct requests for a disabled theme for administrator and valid support', async () => {
  const { requireAdministratorFeature, requireAdministratorFeaturePage } = await import('@/lib/rbac/auth-guard')
  const { saveAppTheme } = await import('@/lib/theme-actions')
  const f = await createPolicyFixture('theme')
  try {
    await withOwner(async tx => {
      await tx.execute(sql`update public.tenant_settings set support_until = now() + interval '1 hour', support_granted_at = now() - interval '1 minute'`)
      await tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, object_type, object_id, details)
        values (${f.platformAdminId}, 'platform', 'support.enter', 'tenant', ${String(f.tenantId)}, '{"reason":"theme test"}')`)
    }, f.tenantId)
    await disable(f, ['appearance'])
    for (const kind of ['administrator', 'support'] as const) {
      session.user = { id: kind === 'support' ? f.platformAdminId : f.adminId, tenantState: kind === 'support' ? 'support' : 'ready', tenantId: f.tenantId }
      await expect(requireAdministratorFeature('manage-tenant-theme')).rejects.toThrow('Unauthorized')
      await expect(requireAdministratorFeaturePage('manage-tenant-theme')).rejects.toThrow('REDIRECT')
      expect(await saveAppTheme({ primaryColor: '#123456', surfaces: { light: {}, dark: {} } })).toEqual({ saved: false, error: 'unauthorized' })
    }
  } finally { await f.close() }
})

it('assigns and revokes an existing role with dormant grants while still protecting the administrator role', async () => {
  const { updateUserRoles } = await import('@/lib/rbac/users-actions')
  const { assignableRoleIds } = await import('@/lib/rbac/grant-service')
  const f = await createPolicyFixture('dormant')
  try {
    await grantCodes(f, ['manage-menu'])
    await withTenant(f.tenantId, tx => tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${f.roleId}, ${f.menuEntryId})`))
    // Un ruolo delegato distinto può assegnare persone ma non possiede i grant dormienti.
    const [manager] = await withTenant(f.tenantId, tx => tx.execute<{ id: number }>(sql`insert into public.role (id_role_type, description)
      values (2, 'assignment manager') returning id_role::int as id`))
    await withTenant(f.tenantId, async tx => {
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${manager.id}, id_permission from public.permission where code = 'assign-user-roles'`)
      await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${f.memberId}, ${manager.id})`)
    })
    await disable(f, ['navigation'])
    // La voce menu del ruolo punta alla lettura utenti: spegniamo solo quella capacità senza togliere l'assegnazione.
    await withOwner(tx => tx.execute(sql`update public.menu_entry set canonical_link = '/functionalities', functionality_link = '/user-management', area_key = null, feature_key = null
      where id_menu_entry = ${f.menuEntryId}`), f.tenantId)
    session.user = { id: f.memberId, tenantState: 'ready', tenantId: f.tenantId }
    const actor = (await resolveActor(f.tenantId, f.memberId))!
    expect(await withTenant(f.tenantId, tx => assignableRoleIds(tx, actor, [f.roleId]))).toEqual([f.roleId])
    await updateUserRoles(f.memberId, [manager.id, f.roleId])
    await updateUserRoles(f.memberId, [manager.id])
    await expect(updateUserRoles(f.adminId, [f.roleId])).rejects.toThrow('Administrator')
    const [unchanged] = await withTenant(f.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count
      from public.role_permission where id_role = ${f.roleId}`))
    expect(unchanged.count).toBe(1)
  } finally { await f.close() }
})

/** Il writer deve essere realmente in attesa del lock, non soltanto avviato nello stesso tick. */
async function expectPolicyWaiter(f: PolicyFixture) {
  await expect.poll(async () => {
    const [row] = await withTenant(f.tenantId, tx => tx.execute<{ waiting: boolean }>(sql`
      select exists(select 1 from pg_catalog.pg_locks where locktype = 'advisory' and not granted) as waiting`))
    return row.waiting
  }, { timeout: 3_000, interval: 10 }).toBe(true)
}

it('serializes a direct SQL assignment behind suspension and rejects it after the suspension commits', async () => {
  const f = await createPolicyFixture('grant-race')
  let release!: () => void
  let locked!: () => void
  const acquired = new Promise<void>(resolve => { locked = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const suspension = withOwner(async tx => {
    await tx.execute(sql`select app_private.lock_tenant_policy()`)
    await tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'people'`)
    locked()
    await held
  }, f.tenantId)
  try {
    await acquired
    const assignment = grantCodes(f, ['read-users'])
    const refusal = expect(assignment).rejects.toMatchObject({ cause: { message: expect.stringContaining('tenant_feature_disabled') } })
    await expectPolicyWaiter(f)
    release()
    await suspension
    await refusal
    const [row] = await withTenant(f.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count from public.role_permission where id_role = ${f.roleId}`))
    expect(row.count).toBe(0)
  } finally { release(); await suspension; await f.close() }
})

it('does not write a theme admitted by the first guard when suspension commits before its write transaction', async () => {
  const { saveAppTheme } = await import('@/lib/theme-actions')
  const f = await createPolicyFixture('theme-race')
  session.user = { id: f.adminId, tenantState: 'ready', tenantId: f.tenantId }
  const [before] = await withTenant(f.tenantId, tx => tx.execute<{ color: string }>(sql`select primary_color as color from public.app_theme`))
  let release!: () => void
  let locked!: () => void
  const acquired = new Promise<void>(resolve => { locked = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const suspension = withOwner(async tx => {
    await tx.execute(sql`select app_private.lock_tenant_policy()`)
    await tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'appearance'`)
    locked()
    await held
  }, f.tenantId)
  try {
    await acquired
    const saving = saveAppTheme({ primaryColor: '#123456', surfaces: { light: {}, dark: {} } }, { acknowledgeWarnings: true })
    await expectPolicyWaiter(f)
    release()
    await suspension
    // Il log diagnostico theme/Unauthorized è atteso: il controllo sotto lock ha rifiutato.
    expect(await saving).toEqual({ saved: false, error: 'failed' })
    const [after] = await withTenant(f.tenantId, tx => tx.execute<{ color: string; events: number }>(sql`select primary_color as color,
      (select count(*)::int from public.tenant_audit_event where operation = 'theme.save') as events from public.app_theme`))
    expect(after).toEqual({ color: before.color, events: 0 })
  } finally { release(); await suspension; await f.close() }
})

it('copies suspended grants only through the owner path and refuses a forged runtime copy mode', async () => {
  const f = await createPolicyFixture('copy')
  let copied: ReturnType<typeof tenantIdForTest> | undefined
  try {
    await grantReadUsers(f)
    await disable(f, ['people'])
    const copy = await withOwner(async tx => {
      const [row] = await tx.execute<{ id: string }>(sql`select app_private.copy_tenant(${f.tenantId}, ${`${f.slug}-copy`}, 'copy suspended', false)::text as id`)
      const [mode] = await tx.execute<{ mode: string | null }>(sql`select current_setting('app.copy_suspended_grants', true) as mode`)
      expect(mode.mode).not.toBe('on')
      return row
    })
    copied = tenantIdForTest(Number(copy.id))
    await withTenant(copied, async tx => {
      const [state] = await tx.execute<{ grants: number; enabled: boolean }>(sql`select
        (select count(*)::int from public.role_permission rp join public.role r on r.id_role = rp.id_role where r.description = ${f.slug}) as grants,
        exists(select 1 from app_private.effective_tenant_feature_codes() where code = 'read-users') as enabled`)
      expect(state).toEqual({ grants: 1, enabled: false })
    })
    const [mode] = await withOwner(tx => tx.execute<{ mode: string | null }>(sql`select current_setting('app.copy_suspended_grants', true) as mode`))
    expect(mode.mode).not.toBe('on')
    await expect(withTenant(f.tenantId, async tx => {
      await tx.execute(sql`select set_config('app.copy_suspended_grants', 'on', true)`)
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${f.roleId}, id_permission from public.permission where code = 'invite-users'`)
    })).rejects.toMatchObject({ cause: { message: 'tenant_grant_copy_owner_only' } })
    await expect(withTenant(f.tenantId, tx => tx.execute(sql`select app_private.copy_tenant(${f.tenantId}, 'forged', 'forged', false)`)))
      .rejects.toMatchObject({ cause: { code: '42501' } })
  } finally { if (copied !== undefined) await deleteTenantForTest(copied); await f.close() }
})

afterAll(closeOwner)

it('uses the same current ceiling for role page candidates and administrator grant actions while allowing revocation', async () => {
  const { grantableItemIds } = await import('@/lib/rbac/grant-service')
  const { updateRolePermissions } = await import('@/lib/rbac/roles-actions')
  const f = await createPolicyFixture('grant-action')
  try {
    await grantReadUsers(f)
    session.user = { id: f.adminId, tenantState: 'ready', tenantId: f.tenantId }
    const actorBeforeSuspension = (await resolveActor(f.tenantId, f.adminId))!
    const ids = await withTenant(f.tenantId, tx => tx.execute<{ id: number; code: string }>(sql`
      select id_permission::int as id, code from public.permission where code in ('read-users', 'invite-users')`))
    const readId = ids.find(row => row.code === 'read-users')!.id
    const inviteId = ids.find(row => row.code === 'invite-users')!.id
    await disable(f, ['people'])
    expect(await withTenant(f.tenantId, tx => grantableItemIds(tx, actorBeforeSuspension, {
      operationIds: [readId, inviteId], functionalityIds: [f.menuEntryId],
    }))).toEqual({ operationIds: [], functionalityIds: [] })
    await expect(updateRolePermissions(f.roleId, { operations: [{ idItem: inviteId, authorization: true }], functionalities: [] }))
      .rejects.toThrow('invite-users')
    // Un aggiornamento senza cambio di capacità non trasforma il diritto dormiente in un grant nuovo.
    await withTenant(f.tenantId, tx => tx.execute(sql`update public.role_permission set id_role = id_role where id_role = ${f.roleId}`))
    await updateRolePermissions(f.roleId, {
      operations: [{ idItem: readId, authorization: false }],
      functionalities: [{ idItem: f.menuEntryId, authorization: false }],
    })
    const [remaining] = await withTenant(f.tenantId, tx => tx.execute<{ permissions: number; menu: number }>(sql`select
      (select count(*)::int from public.role_permission where id_role = ${f.roleId}) as permissions,
      (select count(*)::int from public.role_functionality where id_role = ${f.roleId}) as menu`))
    expect(remaining).toEqual({ permissions: 0, menu: 0 })
  } finally { await f.close() }
})
