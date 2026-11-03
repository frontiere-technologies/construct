import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor } from '@/lib/rbac/actor'
import { startSupport } from '@/lib/platform/support-actions'
import { closeTenantExportExecutor } from '@/lib/db/tenant-export-scope'
import * as tenantAccess from '@/lib/db/tenant-db'
import type { TenantTx, TransactionOptions } from '@/lib/db/tenant-db'
import { GET as exportRoute } from '@/app/api/tenant/export/route'
import { createPolicyFixture, type PolicyFixture } from './policy-test-fixture'
import { parseTenantArchive } from './tenant-archive-schema'
import { FEATURE_KEYS } from './feature-catalog'
import { readSupportInProgress, selectSupportAccess } from './support-consent'
import { grantSupportConsent } from './support-consent-actions'
import { requireTenantExporter } from './tenant-export-access'
import type { TenantId } from './tenant-id'

const request = vi.hoisted(() => ({ session: { user: {} as Record<string, unknown> } }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => request.session }))
vi.mock('@/lib/auth', () => ({ unstable_update: async () => request.session }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3001' }) }))

async function supportActor(f: PolicyFixture) {
  request.session.user = { id: f.adminId, tenantId: f.tenantId, tenantState: 'ready' }
  await grantSupportConsent('1h', { allowExport: true })
  request.session.user = { id: f.platformAdminId, tenantState: 'none' }
  await startSupport(f.tenantId, 'Synthetic archive support')
  request.session.user = { id: f.platformAdminId, tenantId: f.tenantId, tenantState: 'support' }
  return requireTenantExporter()
}

async function seed(f: PolicyFixture) {
  await withOwner(async tx => {
    await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
      select ${f.roleId}, id_permission from public.permission where code = 'read-users' on conflict do nothing`)
    await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${f.roleId}, ${f.menuEntryId})`)
    await tx.execute(sql`insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag) values (${f.menuEntryId}, 'en', 'export')`)
    await tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_email, actor_kind, operation, object_type, object_id, occurred_at, details)
      values (${f.adminId}, 'sample@example.test', 'person', 'role.create', 'role', ${String(f.roleId)}, '2026-11-03 10:00:00.123456+00',
        '{"name":"Allowed sample","surprise":"MUST_NOT_EXPORT","password":"MUST_NOT_EXPORT"}'::jsonb)`)
    await tx.execute(sql`insert into public.role (id_role, id_role_type, description) values (9007199254740993, 2, 'Large exact id')`)
    await tx.execute(sql`insert into public.tenant_host (host, id_tenant) values (${`${f.slug}.example.test`}, ${f.tenantId})`)
    await tx.execute(sql`update public.users set password_hash = 'MUST_NOT_EXPORT', auth_provider = 'MUST_NOT_EXPORT', sub = 'MUST_NOT_EXPORT'
      where id = ${f.adminId}`)
    await tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', false)
      on conflict (id_tenant, feature_code) do update set allowed = false`)
  }, f.tenantId)
}

describeIntegration('tenant export: bounded repeatable snapshot and isolated archive', () => {
  beforeEach(() => { request.session.user = {}; vi.unstubAllEnvs(); vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'multi') })
  afterAll(async () => { vi.unstubAllEnvs(); await closeTenantExportExecutor(); await closeOwner() })

  it('exports every tenant table with exact counts, shared identities, closed audit details and no data from B', async () => {
    const a = await createPolicyFixture('export-a')
    const b = await createPolicyFixture('export-b')
    try {
      await seed(a)
      await withOwner(tx => tx.execute(sql`insert into public.tenant_membership (user_id) values (${a.memberId})`), b.tenantId)
      await withOwner(tx => tx.execute(sql`update public.users set name = 'PRIVATE_SHARED_NAME', username = 'PRIVATE_SHARED_USERNAME',
        first_name = 'Shared', last_name = 'Member', email = 'shared-member@example.test' where id = ${a.memberId}`))
      request.session.user = { id: a.adminId, tenantId: a.tenantId, tenantState: 'ready' }
      const actor = await resolveActor(a.tenantId, a.adminId)
      expect(actor).not.toBeNull()
      const bytes = await (await import('./tenant-export-service')).prepareTenantExport(actor!, new AbortController().signal)
      const raw = new TextDecoder().decode(bytes)
      const archive = parseTenantArchive(JSON.parse(raw))
      for (const rows of Object.values(archive.tables)) expect(rows.length).toBeGreaterThan(0)
      for (const [name, rows] of Object.entries(archive.tables)) {
        expect(archive.counts[name as keyof typeof archive.counts]).toBe(rows.length)
        expect(rows.every(row => row.id_tenant === String(a.tenantId))).toBe(true)
      }
      expect(archive.tables.role.some(row => row.id_role === '9007199254740993')).toBe(true)
      expect.soft(archive.identities.find(row => row.id === a.memberId)).toEqual({ id: a.memberId, first_name: 'Shared', last_name: 'Member', email: 'shared-member@example.test' })
      expect(archive.identities.map(row => row.id)).not.toContain(b.adminId)
      expect(archive.tables.tenant_audit_event[0].details).toEqual({ name: 'Allowed sample' })
      expect.soft(archive.tables.tenant_audit_event[0].occurred_at).toBe('2026-11-03T10:00:00.123456Z')
      expect(archive.tables.tenant_audit_event.some(row => row.operation === 'tenant.export.prepare')).toBe(false)
      expect(raw).not.toMatch(/MUST_NOT_EXPORT|PRIVATE_SHARED_NAME|PRIVATE_SHARED_USERNAME|password|auth_provider|is_platform_admin|last_tenant_id/)
      expect(raw).not.toContain(b.slug)
      const [prepared] = await withTenant(a.tenantId, tx => tx.execute<{ count: number }>(sql`
        select count(*)::int as count from public.tenant_audit_event where operation = 'tenant.export.prepare'`))
      expect(prepared.count).toBe(1)
      expect(FEATURE_KEYS).toContain('export-tenant-data')
    } finally { await b.close(); await a.close() }
  })

  it('fails closed when a newly classified tenant table is not handled', async () => {
    const a = await createPolicyFixture('export-new')
    try {
      await withOwner(tx => tx.execute(sql`insert into app_private.table_class (table_name, class) values ('zzz_export_unhandled', 'tenant')`))
      const actor = await resolveActor(a.tenantId, a.adminId)
      await expect((await import('./tenant-export-service')).prepareTenantExport(actor!, new AbortController().signal)).rejects.toThrow(/coverage|unhandled/)
      for (const operation of ['export', 'restore', 'delete']) {
        await expect(withTenant(a.tenantId, tx => tx.execute(sql`select app_private.assert_tenant_data_coverage(${operation})`))).rejects.toThrow()
      }
    } finally {
      await withOwner(tx => tx.execute(sql`delete from app_private.table_class where table_name = 'zzz_export_unhandled'`))
      await a.close()
    }
  })

  it('never treats restored support entries or exits as live authorization', async () => {
    const a = await createPolicyFixture('export-history')
    try {
      await withOwner(async tx => {
        await tx.execute(sql`update public.tenant_settings set support_until = now() + interval '1 hour',
          support_granted_at = now() - interval '1 minute', support_granted_by = ${a.adminId}, support_export_allowed = true`)
        await tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, origin, source_tenant_id, source_event_id)
          values (${a.platformAdminId}, 'platform', 'support.enter', 'restored', 'old-tenant', '123')`)
      }, a.tenantId)
      const state = () => withTenant(a.tenantId, async tx => ({
        open: await readSupportInProgress(tx),
        access: await selectSupportAccess(tx, a.platformAdminId, 'localhost:3001', { entry: true }),
      }))
      expect(await state()).toMatchObject({ open: false, access: { entryOpen: false } })
      await withOwner(tx => tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation)
        values (${a.platformAdminId}, 'platform', 'support.enter')`), a.tenantId)
      await withOwner(tx => tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, origin)
        values (${a.platformAdminId}, 'platform', 'support.exit', 'restored')`), a.tenantId)
      expect(await state()).toMatchObject({ open: true, access: { entryOpen: true } })
    } finally { await a.close() }
  })

  it('keeps historical non-member identities minimal and records support preparation in both audits', async () => {
    const a = await createPolicyFixture('export-support')
    try {
      await withOwner(tx => tx.execute(sql`update public.users set name = 'PRIVATE_PLATFORM_PROFILE', first_name = 'PRIVATE_PLATFORM_PROFILE',
        last_name = 'PRIVATE_PLATFORM_PROFILE', username = 'PRIVATE_PLATFORM_PROFILE' where id = ${a.platformAdminId}`))
      const actor = await supportActor(a)
      const bytes = await (await import('./tenant-export-service')).prepareTenantExport(actor, new AbortController().signal)
      const raw = new TextDecoder().decode(bytes)
      const archive = parseTenantArchive(JSON.parse(raw))
      expect(raw).not.toContain('PRIVATE_PLATFORM_PROFILE')
      const event = archive.tables.tenant_audit_event.find(row => row.operation === 'support.enter')
      expect(archive.identities.find(row => row.id === a.platformAdminId)).toEqual({
        id: a.platformAdminId, email: event?.actor_email, first_name: null, last_name: null,
      })
      expect(archive.tables.tenant_audit_event.map(row => row.operation)).toEqual(['support.grant', 'support.enter'])
      const [counts] = await withOwner(tx => tx.execute<{ tenant: number; platform: number }>(sql`select
        (select count(*)::int from public.tenant_audit_event where operation = 'tenant.export.prepare') as tenant,
        (select count(*)::int from public.platform_audit_event where id_tenant = ${a.tenantId} and operation = 'tenant.export.prepare') as platform`), a.tenantId)
      expect(counts).toEqual({ tenant: 1, platform: 1 })
    } finally { await a.close() }
  })

  it('enforces the exact byte limit and rejects one byte more before fetching an oversized page', async () => {
    const a = await createPolicyFixture('export-bytes')
    const service = await import('./tenant-export-service')
    try {
      const actor = (await resolveActor(a.tenantId, a.adminId))!
      const baseline = await service.prepareTenantExport(actor, new AbortController().signal)
      const length = 52_428_800 - baseline.byteLength + a.slug.length
      const replace = async (size: number) => withOwner(async tx => {
        await tx.execute(sql`delete from public.tenant_audit_event where operation = 'tenant.export.prepare'`)
        await tx.execute(sql`update public.role set description = repeat('x', ${size}) where id_role = ${a.roleId}`)
      }, a.tenantId)
      await replace(length)
      const exact = await service.prepareTenantExport(actor, new AbortController().signal)
      expect(exact.byteLength).toBe(52_428_800)
      await replace(length + 1)
      await expect(service.prepareTenantExport(actor, new AbortController().signal)).rejects.toThrow('tenant_export_size_limit')
      const [audit] = await withTenant(a.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count
        from public.tenant_audit_event where operation = 'tenant.export.prepare'`))
      expect(audit.count).toBe(0)
    } finally { await a.close() }
  }, 20_000) // Real 50 MiB payload crosses the driver once; no mocked size check.

  it('exports an earlier preparation audit with its details as a JSON object', async () => {
    const a = await createPolicyFixture('export-repeat')
    const service = await import('./tenant-export-service')
    try {
      const actor = (await resolveActor(a.tenantId, a.adminId))!
      const first = await service.prepareTenantExport(actor, new AbortController().signal)
      const second = await service.prepareTenantExport(actor, new AbortController().signal)
      const archive = parseTenantArchive(JSON.parse(new TextDecoder().decode(second)))
      const events = archive.tables.tenant_audit_event.filter(row => row.operation === 'tenant.export.prepare')
      expect(events).toHaveLength(1)
      expect(events[0].details).toEqual({ formatVersion: 1, bytes: first.byteLength })
    } finally { await a.close() }
  })

  it('stops the actual exporter at sixty seconds measured on a controlled monotonic clock', async () => {
    const a = await createPolicyFixture('export-deadline')
    const service = await import('./tenant-export-service')
    let time = 0
    try {
      vi.spyOn(performance, 'now').mockImplementation(() => time)
      const append = service.TenantArchiveWriter.prototype.append
      vi.spyOn(service.TenantArchiveWriter.prototype, 'append').mockImplementation(function (this: InstanceType<typeof service.TenantArchiveWriter>, text: string) {
        if (text.includes('"tables":{')) time = 60_000
        return append.call(this, text)
      })
      const actor = (await resolveActor(a.tenantId, a.adminId))!
      await expect(service.prepareTenantExport(actor, new AbortController().signal)).rejects.toThrow('tenant_export_deadline')
      const [audit] = await withTenant(a.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count
        from public.tenant_audit_event where operation = 'tenant.export.prepare'`))
      expect(audit.count).toBe(0)
    } finally { vi.restoreAllMocks(); await a.close() }
  })

  it('keeps a repeatable snapshot when another committed transaction changes data between reads', async () => {
    const a = await createPolicyFixture('export-snapshot')
    const service = await import('./tenant-export-service')
    const original = tenantAccess.withTenant
    try {
      const actor = (await resolveActor(a.tenantId, a.adminId))!
      // Interleave two real DB transactions at the service's transaction boundary. No fake rows.
      vi.spyOn(tenantAccess, 'withTenant').mockImplementation(async function <T>(id: TenantId, work: (tx: TenantTx) => Promise<T>, options?: TransactionOptions): Promise<T> {
        return original(id, async tx => {
          await tx.execute(sql`select name from public.menu_entry where id_menu_entry = ${a.menuEntryId}`)
          await withOwner(owner => owner.execute(sql`update public.menu_entry set name = 'changed-after-snapshot' where id_menu_entry = ${a.menuEntryId}`), a.tenantId)
          return work(tx)
        }, options)
      })
      const archive = parseTenantArchive(JSON.parse(new TextDecoder().decode(await service.prepareTenantExport(actor, new AbortController().signal))))
      expect(archive.tables.menu_entry.find(row => row.id_menu_entry === String(a.menuEntryId))?.name).toBe(a.slug)
      const [live] = await withOwner(tx => tx.execute<{ name: string }>(sql`select name from public.menu_entry where id_menu_entry = ${a.menuEntryId}`), a.tenantId)
      expect(live.name).toBe('changed-after-snapshot')
    } finally { vi.restoreAllMocks(); await a.close() }
  })

  it('rolls back both preparation audits when the platform audit insert fails', async () => {
    const a = await createPolicyFixture('export-atomic')
    try {
      const actor = await supportActor(a)
      await withOwner(tx => tx.execute(sql`alter table public.platform_audit_event add constraint t10_export_failure check (operation <> 'tenant.export.prepare') not valid`))
      await expect((await import('./tenant-export-service')).prepareTenantExport(actor, new AbortController().signal)).rejects.toThrow()
      const [row] = await withOwner(tx => tx.execute<{ tenant: number; platform: number }>(sql`select
        (select count(*)::int from public.tenant_audit_event where operation = 'tenant.export.prepare') as tenant,
        (select count(*)::int from public.platform_audit_event where id_tenant = ${a.tenantId} and operation = 'tenant.export.prepare') as platform`), a.tenantId)
      expect(row).toEqual({ tenant: 0, platform: 0 })
    } finally {
      await withOwner(tx => tx.execute(sql`alter table public.platform_audit_event drop constraint if exists t10_export_failure`))
      await a.close()
    }
  })

  it('delivers no HTTP attachment if the tenant becomes suspended after preparing the snapshot', async () => {
    const a = await createPolicyFixture('export-revoked')
    const service = await import('./tenant-export-service')
    const original = service.prepareTenantExport
    try {
      request.session.user = { id: a.adminId, tenantId: a.tenantId, tenantState: 'ready' }
      vi.spyOn(service, 'prepareTenantExport').mockImplementation(async (actor, signal) => {
        const result = await original(actor, signal)
        await withOwner(tx => tx.execute(sql`update public.tenant set status = 'suspended' where id = ${a.tenantId}`))
        return result
      })
      const response = await exportRoute(new Request('http://localhost:3001/api/tenant/export'))
      expect(response.status).toBe(403)
      expect(response.headers.has('Content-Disposition')).toBe(false)
      expect(await response.json()).toEqual({ error: 'tenant_export_unavailable' })
    } finally { vi.restoreAllMocks(); await a.close() }
  })
})
