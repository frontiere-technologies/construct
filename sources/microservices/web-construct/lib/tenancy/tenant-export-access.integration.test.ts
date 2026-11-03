import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { startSupport } from '@/lib/platform/support-actions'
import { getTenantForPlatform } from '@/lib/platform/tenant-service'
import { resolveActor, resolveSupportActor } from '@/lib/rbac/actor'
import { createPolicyFixture, type PolicyFixture } from './policy-test-fixture'
import { grantSupportConsent, revokeSupportConsent } from './support-consent-actions'
import { tenantIdForTest } from './testing'

const mocks = vi.hoisted(() => ({ session: { user: {} as Record<string, unknown> }, host: 'localhost:3001' }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ unstable_update: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: mocks.host }) }))

const access = () => import('./tenant-export-access')
const asAdmin = (f: PolicyFixture) => { mocks.session.user = { id: f.adminId, tenantId: f.tenantId, tenantState: 'ready' } }
async function enter(f: PolicyFixture, allowExport?: boolean) {
  asAdmin(f)
  if (allowExport === undefined) await grantSupportConsent('1h')
  else await grantSupportConsent('1h', { allowExport })
  mocks.session.user = { id: f.platformAdminId, tenantState: 'none' }
  await startSupport(f.tenantId, 'Verifica consenso esportazione')
  mocks.session.user = { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'support' }
}

async function consent(f: PolicyFixture) {
  const [row] = await withTenant(f.tenantId, tx => tx.execute<{ allowed: boolean | null; grants: number; choice: boolean | null }>(sql`
    select (to_jsonb(s)->>'support_export_allowed')::boolean as allowed,
      (select count(*)::int from public.tenant_audit_event where operation = 'support.grant') as grants,
      (select (details->>'allowExport')::boolean from public.tenant_audit_event
        where operation = 'support.grant' order by id desc limit 1) as choice
    from public.tenant_settings s`))
  return row
}

describeIntegration('tenant export access: explicit consent and fresh authorization', () => {
  beforeEach(() => { mocks.session.user = {}; mocks.host = 'localhost:3001'; vi.unstubAllEnvs() })
  afterAll(async () => { vi.unstubAllEnvs(); await closeOwner() })

  it('does not upgrade an old support consent into an export consent', async () => {
    const f = await createPolicyFixture('export-old')
    try {
      await enter(f)
      // Valid support really exists; denial must be the distinct export extension.
      expect(await resolveSupportActor(f.tenantId, f.platformAdminId)).toMatchObject({ support: true })
      expect(await consent(f)).toMatchObject({ allowed: false, choice: false })
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  it('records explicit export consent atomically and admits valid support', async () => {
    const f = await createPolicyFixture('export-yes')
    try {
      await enter(f, true)
      expect(await consent(f)).toMatchObject({ allowed: true, choice: true, grants: 1 })
      const actor = await (await access()).requireTenantExporter()
      expect(actor).toMatchObject({ userId: f.platformAdminId, tenantId: f.tenantId, support: true })
      await expect((await access()).assertTenantExportStillAllowed(actor)).resolves.toBeUndefined()
    } finally { await f.close() }
  })

  it.each([undefined, false])('renewal with %s removes the export extension and closes the old entry', async allowExport => {
    const f = await createPolicyFixture('export-renew')
    try {
      await enter(f, true)
      const actor = await (await access()).requireTenantExporter()
      asAdmin(f)
      if (allowExport === undefined) await grantSupportConsent('1h')
      else await grantSupportConsent('1h', { allowExport })
      expect(await consent(f)).toMatchObject({ allowed: false, choice: false, grants: 2 })
      await expect((await access()).assertTenantExportStillAllowed(actor)).rejects.toThrow('Unauthorized')
      mocks.session.user = { id: f.platformAdminId, tenantState: 'none' }
      await startSupport(f.tenantId, 'Rientro dopo rinnovo senza estensione')
      mocks.session.user = { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'support' }
      expect(await resolveSupportActor(f.tenantId, f.platformAdminId)).toMatchObject({ support: true })
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  it('does not allow platform support to grant itself export consent or write audit entries', async () => {
    const f = await createPolicyFixture('export-self')
    try {
      await enter(f)
      const before = await consent(f)
      const counts = () => withOwner(tx => tx.execute(sql`select
        (select count(*)::int from public.tenant_audit_event) as tenant_events,
        (select count(*)::int from public.platform_audit_event where id_tenant = ${f.tenantId}) as platform_events`), f.tenantId)
      const beforeAudit = await counts()
      await expect(grantSupportConsent('1h', { allowExport: true })).rejects.toThrow('Unauthorized')
      expect(await consent(f)).toEqual(before)
      expect(await counts()).toEqual(beforeAudit)
    } finally { await f.close() }
  })

  it('rejects a missing support entry even with explicit consent', async () => {
    const f = await createPolicyFixture('export-entry')
    try {
      asAdmin(f)
      await grantSupportConsent('1h', { allowExport: true })
      mocks.session.user = { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'support' }
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  it('exposes only export state and expiry in platform consent metadata, including expired consent', async () => {
    const f = await createPolicyFixture('export-metadata')
    try {
      await enter(f, true)
      mocks.session.user = { id: f.platformAdminId, tenantState: 'none' }
      expect((await getTenantForPlatform(f.tenantId))?.support).toEqual({ until: expect.any(String), exportAllowed: true })
      await withOwner(tx => tx.execute(sql`update public.tenant_settings set support_until = now() - interval '1 second'`), f.tenantId)
      expect((await getTenantForPlatform(f.tenantId))?.support).toEqual({ until: null, exportAllowed: false })
    } finally { await f.close() }
  })

  const supportChanges: [string, (f: PolicyFixture) => Promise<unknown>][] = [
    ['revoked consent', async f => { asAdmin(f); await revokeSupportConsent(); expect((await consent(f)).allowed).toBe(false) }],
    ['expired consent', f => withOwner(tx => tx.execute(sql`update public.tenant_settings set support_until = now() - interval '1 second'`), f.tenantId)],
    ['suspended tenant', f => withOwner(tx => tx.execute(sql`update public.tenant set status = 'suspended' where id = ${f.tenantId}`))],
    ['archived tenant', f => withOwner(tx => tx.execute(sql`update public.tenant set status = 'archived' where id = ${f.tenantId}`))],
    ['disabled platform account', f => withOwner(tx => tx.execute(sql`update public.users set id_user_status = 1 where id = ${f.platformAdminId}`))],
    ['removed platform attribute', f => withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = false where id = ${f.platformAdminId}`))],
    ['closed support entry', f => withOwner(tx => tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, object_type)
      values (${f.platformAdminId}, 'platform', 'support.exit', 'tenant')`), f.tenantId)],
    ['dedicated address', async () => { mocks.host = 'export-dedicated.localhost' }],
  ]
  it.each(supportChanges)('both guards reject %s after preparation', async (label, change) => {
    const f = await createPolicyFixture(`export-${label}`)
    try {
      if (label === 'dedicated address') await withOwner(tx => tx.execute(sql`insert into public.tenant_host (id_tenant, host) values (${f.tenantId}, 'export-dedicated.localhost')`))
      await enter(f, true)
      const actor = await (await access()).requireTenantExporter()
      await withTenant(f.tenantId, async snapshot => {
        const [before] = await snapshot.execute<{ allowed: boolean }>(sql`select support_export_allowed as allowed from public.tenant_settings`)
        expect(before.allowed).toBe(true)
        await change(f)
        mocks.session.user = { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'support' }
        await expect((await access()).assertTenantExportStillAllowed(actor)).rejects.toThrow('Unauthorized')
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  it('admits the tenant administrator without support or optional settings, and rejects a member', async () => {
    const f = await createPolicyFixture('export-admin')
    try {
      await withOwner(tx => tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'tenant-settings'`), f.tenantId)
      asAdmin(f)
      const actor = await (await access()).requireTenantExporter()
      expect(actor).toMatchObject({ userId: f.adminId, isAdmin: true })
      expect(actor.support).toBeUndefined()
      await expect((await access()).assertTenantExportStillAllowed(actor)).resolves.toBeUndefined()
      await withTenant(f.tenantId, async tx => {
        await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
          select ${f.roleId}, id_permission from public.permission where code = 'manage-support-consent'`)
        await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${f.memberId}, ${f.roleId})`)
      })
      mocks.session.user = { id: f.memberId, tenantId: f.tenantId, tenantState: 'ready' }
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  const adminChanges: [string, (f: PolicyFixture) => SQL][] = [
    ['disabled account', f => sql`update public.users set id_user_status = 1 where id = ${f.adminId}`],
    ['removed role', f => sql`delete from public.user_role ur using public.role r where r.id_role = ur.id_role and r.id_tenant = ur.id_tenant
      and ur.user_id = ${f.adminId} and r.system_key = 'TENANT_ADMIN'`],
    ['deactivated membership', f => sql`update public.tenant_membership set status = 'deactivated' where user_id = ${f.adminId}`],
    ['suspended tenant', f => sql`update public.tenant set status = 'suspended' where id = ${f.tenantId}`],
    ['archived tenant', f => sql`update public.tenant set status = 'archived' where id = ${f.tenantId}`],
  ]
  it.each(adminChanges)('revalidates an administrator with %s outside an earlier stable snapshot', async (_label, change) => {
    const f = await createPolicyFixture('export-fresh')
    try {
      asAdmin(f)
      const actor = await (await access()).requireTenantExporter()
      // Prime the ordinary resolver too: the export guard must never rely on React's cached actor.
      expect(await resolveActor(f.tenantId, f.adminId)).toMatchObject({ isAdmin: true })
      await withTenant(f.tenantId, async snapshot => {
        await snapshot.execute(sql`select count(*) from public.tenant_settings`)
        await withOwner(tx => tx.execute(change(f)), f.tenantId)
        // The earlier export snapshot still exists, but delivery must use a new transaction.
        await expect((await access()).assertTenantExportStillAllowed(actor)).rejects.toThrow('Unauthorized')
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
    } finally { await f.close() }
  })

  it.each([null, {}, { allowExport: 'true' }])('rejects invalid options %j without writing consent or an audit event', async options => {
    const f = await createPolicyFixture('export-invalid')
    try {
      asAdmin(f)
      const before = await consent(f)
      await expect(grantSupportConsent('1h', options as unknown as { allowExport: boolean })).rejects.toThrow('Consenso esportazione non valido')
      expect(await consent(f)).toEqual(before)
    } finally { await f.close() }
  })

  it('refuses a platform session outside support and an unselected tenant', async () => {
    const f = await createPolicyFixture('export-session')
    try {
      await enter(f, true)
      for (const user of [
        { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'ready' },
        { id: f.adminId, tenantState: 'choose' },
        {},
      ]) {
        mocks.session.user = user
        await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
      }
    } finally { await f.close() }
  })

  it('in single mode admits only the actual administrator of default and closes support', async () => {
    const f = await createPolicyFixture('export-single')
    const [target] = await withOwner(tx => tx.execute<{ id: string }>(sql`select id::text from public.tenant where slug = 'default'`))
    const tenantId = tenantIdForTest(Number(target.id))
    try {
      await enter(f, true)
      const supportActor = await (await access()).requireTenantExporter()
      await withOwner(async tx => {
        await tx.execute(sql`insert into public.tenant_membership (user_id) values (${f.adminId})`)
        await tx.execute(sql`insert into public.user_role (user_id, id_role)
          select ${f.adminId}, id_role from public.role where system_key = 'TENANT_ADMIN'`)
      }, tenantId)
      vi.stubEnv('AUTH_URL', 'http://localhost:3001')
      vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'single')
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
      await expect((await access()).assertTenantExportStillAllowed(supportActor)).rejects.toThrow('Unauthorized')
      asAdmin(f)
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
      mocks.session.user = { id: f.adminId, tenantId, tenantState: 'ready' }
      const actor = await (await access()).requireTenantExporter()
      expect(actor).toMatchObject({ userId: f.adminId, tenantId, isAdmin: true })
      await expect((await access()).assertTenantExportStillAllowed(actor)).resolves.toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
      await withOwner(async tx => {
        await tx.execute(sql`delete from public.user_role where user_id = ${f.adminId}`)
        await tx.execute(sql`delete from public.tenant_membership where user_id = ${f.adminId}`)
      }, tenantId)
      await f.close()
    }
  })

  it('always refuses the template even with an open platform support entry', async () => {
    const f = await createPolicyFixture('export-template')
    try {
      const [template] = await withOwner(tx => tx.execute<{ id: string }>(sql`select id::text from public.tenant where is_template`))
      const tenantId = tenantIdForTest(Number(template.id))
      mocks.session.user = { id: f.platformAdminId, tenantState: 'none' }
      await startSupport(tenantId, 'Verifica esclusione modello')
      mocks.session.user = { id: f.platformAdminId, tenantId, tenantState: 'support' }
      const actor = await resolveSupportActor(tenantId, f.platformAdminId)
      expect(actor).toMatchObject({ support: true })
      await expect((await access()).requireTenantExporter()).rejects.toThrow('Unauthorized')
      await expect((await access()).assertTenantExportStillAllowed(actor!)).rejects.toThrow('Unauthorized')
    } finally {
      // The template is shared: remove only the support events belonging to this test actor.
      await withOwner(async tx => {
        const [template] = await tx.execute<{ id: string }>(sql`select id::text from public.tenant where is_template`)
        await tx.execute(sql`select set_config('app.tenant_id', ${template.id}, true)`)
        await tx.execute(sql`delete from public.tenant_audit_event where actor_user_id = ${f.platformAdminId}`)
        await tx.execute(sql`delete from public.platform_audit_event where actor_user_id = ${f.platformAdminId}`)
      })
      await f.close()
    }
  })
})
