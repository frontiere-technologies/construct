import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeTenantExportExecutor } from '@/lib/db/tenant-export-scope'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor } from '@/lib/rbac/actor'
import { createPolicyFixture, type PolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import contract from '@/lib/tenancy/tenant-archive-contract.json'
import { parseTenantArchive } from '@/lib/tenancy/tenant-archive-schema'
import { prepareTenantExport } from '@/lib/tenancy/tenant-export-service'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import { listPlatformAudit, listPlatformAuditForTenant } from './audit-service'
import { closePlatform, withPlatform } from './db'
import { deleteTenantPermanently as action } from './tenant-delete-actions'

const mocks = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()), cache: <T>(fn: T) => fn,
}))

const ownedTables = Object.keys(contract.properties.tables.properties)

async function snapshot(id: TenantId) {
  return withOwner(async tx => ({
    tables: await Promise.all(ownedTables.map(name => tx.execute(sql`
      select to_jsonb(t) as row from public.${sql.identifier(name)} t
      where id_tenant = ${id} order by to_jsonb(t)::text`))),
    tenant: await tx.execute(sql`select to_jsonb(t) as row from public.tenant t where id = ${id}`),
    hosts: await tx.execute(sql`select to_jsonb(h) as row from public.tenant_host h where id_tenant = ${id} order by host`),
    audit: await tx.execute<{ row: Record<string, unknown> }>(sql`select to_jsonb(a) as row from public.platform_audit_event a where id_tenant = ${id} order by id`),
  }), id)
}

describeIntegration('permanent tenant erasure', () => {
  let a: PolicyFixture
  let b: PolicyFixture | undefined

  function signIn(id: string) {
    mocks.session = { user: { id, accountActive: true, tenantState: 'none', tenantId: null }, expires: '2099-01-01' }
  }

  function eraseSql() {
    return sql`select app_private.erase_tenant(${a.tenantId}::bigint, ${a.slug}::text, ${a.platformAdminId}::uuid)`
  }

  function archive() {
    return withOwner(tx => tx.execute(sql`update public.tenant set status = 'archived' where id = ${a.tenantId}`))
  }

  beforeEach(async () => {
    b = undefined
    a = await createPolicyFixture('erase-a')
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
    signIn(a.platformAdminId)
  })

  afterEach(async () => {
    try {
      await withOwner(tx => tx.execute(sql`delete from public.platform_audit_event
        where (operation = 'tenant.delete' and object_id = ${String(a.tenantId)})
           or (operation = 'platform.admin.add' and object_id = ${a.memberId})`))
      await b?.close()
      await a.close()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  afterAll(async () => { await closeTenantExportExecutor(); await closePlatform(); await closeOwner() })

  it('keeps exactly one minimal deletion event', async () => {
    b = await createPolicyFixture('erase-b')
    const destination = b
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_membership (user_id) values (${a.memberId})`)
      await tx.execute(sql`insert into public.platform_audit_event
        (id_tenant, actor_kind, operation, object_type, object_id, details) values
        (${destination.tenantId}, 'command', 'tenant.restore', 'tenant', ${String(destination.tenantId)},
          jsonb_build_object('sourceTenantId', ${String(a.tenantId)}::text)),
        (${destination.tenantId}, 'platform', 'tenant.status', 'tenant', ${String(destination.tenantId)}, '{"reason":"B history"}')`)
    }, destination.tenantId)
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_host (id_tenant, host, is_primary)
        values (${a.tenantId}, ${a.slug + '.example.test'}, true)`)
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${a.roleId}, id_permission from public.permission where code = 'read-users'`)
      await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${a.roleId}, ${a.menuEntryId})`)
      await tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', false)`)
      await tx.execute(sql`insert into public.tenant_audit_event (actor_kind, operation, details)
        values ('platform', 'support.enter', '{"reason":"A private support reason"}')`)
      await tx.execute(sql`insert into public.platform_audit_event
        (id_tenant, actor_kind, actor_email, operation, object_type, object_id, details) values
        (${a.tenantId}, 'platform', 'old@example.test', 'tenant.status', 'tenant', ${String(a.tenantId)}, '{"reason":"A private archive reason"}'),
        (${a.tenantId}, 'platform', 'old@example.test', 'tenant.host.remove', 'tenant_host', 'old.example.test', '{"host":"old.example.test"}'),
        (null, 'platform', 'old@example.test', 'platform.admin.add', 'user', ${a.memberId}, '{"email":"shared@example.test"}')`)
      await tx.execute(sql`update public.users set last_tenant_id = ${a.tenantId} where id = ${a.memberId}`)
      await tx.execute(sql`insert into public.password_set_tokens (user_id, token, expires_at)
        values (${a.memberId}, ${'synthetic-' + a.memberId}, now() + interval '1 hour')`)
    }, a.tenantId)
    await archive()

    const globalData = () => withOwner(async tx => ({
      // The existing users_updated_at trigger also runs when the FK clears last_tenant_id.
      users: await tx.execute(sql`select case when id = ${a.memberId} then to_jsonb(u) - 'last_tenant_id' - 'updated_at'
        else to_jsonb(u) end as row from public.users u
        where id in (${a.adminId}, ${a.memberId}, ${a.platformAdminId}) order by id`),
      tokens: await tx.execute(sql`select to_jsonb(t) as row from public.password_set_tokens t where user_id = ${a.memberId}`),
      audit: await tx.execute(sql`select to_jsonb(e) as row from public.platform_audit_event e
        where operation = 'platform.admin.add' and object_id = ${a.memberId}`),
    }))
    const beforeGlobal = await globalData()
    const beforeB = await snapshot(destination.tenantId)
    expect(beforeB.audit).toContainEqual({ row: expect.objectContaining({
      operation: 'tenant.restore', source_tenant_id: String(a.tenantId), details: {},
    }) })
    expect(await action(a.tenantId, a.slug)).toEqual({ ok: true })
    const afterB = await snapshot(destination.tenantId)
    expect(afterB).toEqual({
      ...beforeB,
      audit: beforeB.audit.map(({ row }) => ({
        row: row.operation === 'tenant.restore' ? { ...row, source_tenant_id: null } : row,
      })),
    })
    expect(await globalData()).toEqual(beforeGlobal)
    expect(await snapshot(a.tenantId)).toEqual({ tables: ownedTables.map(() => []), tenant: [], hosts: [], audit: [] })
    const events = await withOwner(tx => tx.execute(sql`
      select operation, id_tenant as "idTenant", object_type as "objectType", object_id as "objectId",
        actor_user_id as "actorUserId", actor_email as "actorEmail", actor_kind as "actorKind",
        occurred_at as "occurredAt", details
      from public.platform_audit_event where id_tenant = ${a.tenantId}
        or source_tenant_id = ${String(a.tenantId)}
        or (object_type = 'tenant' and object_id = ${String(a.tenantId)})`))
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      operation: 'tenant.delete', idTenant: null, objectType: 'tenant', objectId: String(a.tenantId),
      actorUserId: a.platformAdminId, actorEmail: null, actorKind: 'platform', occurredAt: expect.anything(), details: {},
    })
    const [deleted] = (await listPlatformAudit({ page: 0, size: 1, operation: 'tenant.delete' })).rows
    expect(deleted).toMatchObject({ actorUserId: a.platformAdminId, actorEmail: null, objectId: String(a.tenantId), details: {} })
    const [restored] = (await listPlatformAuditForTenant(destination.tenantId, { page: 0, size: 1, operation: 'tenant.restore' })).rows
    expect(restored.details).toEqual({})
    expect(await withOwner(tx => tx.execute(sql`select last_tenant_id from public.users where id = ${a.memberId}`)))
      .toEqual([{ last_tenant_id: null }])
    expect(await action(a.tenantId, a.slug)).toEqual({ ok: false, reason: 'changed' })
  })

  it('requires platform authorization, archived status, and the exact current slug', async () => {
    expect(await action(a.tenantId, a.slug)).toEqual({ ok: false, reason: 'not_archived' })
    await archive()
    expect(await action(a.tenantId, a.slug + '-old')).toEqual({ ok: false, reason: 'changed' })
    expect(await action(-1, a.slug)).toEqual({ ok: false, reason: 'invalid' })
    const protectedTenants = await withOwner(tx => tx.execute<{ id: number; slug: string }>(sql`
      select id::int, slug from public.tenant where slug = 'default' or is_template`))
    expect(protectedTenants).toHaveLength(2)
    for (const row of protectedTenants) {
      expect(await action(row.id, row.slug)).toEqual({ ok: false, reason: 'protected' })
    }
    signIn(a.adminId)
    await expect(action(a.tenantId, a.slug)).rejects.toThrow('Unauthorized')
    expect((await snapshot(a.tenantId)).tenant).toHaveLength(1)
  })

  it('refuses a runtime call and verifies tenant context and actor in the database', async () => {
    await archive()
    await expect(withTenant(a.tenantId, tx => tx.execute(eraseSql()))).rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(withPlatform(tx => tx.execute(eraseSql()))).rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(withPlatform(tx => tx.execute(sql`select app_private.erase_tenant(
      ${a.tenantId}::bigint, ${a.slug}::text, ${a.adminId}::uuid)`), a.tenantId))
      .rejects.toMatchObject({ cause: { code: '42501' } })
    expect((await snapshot(a.tenantId)).tenant).toHaveLength(1)
  })

  it('rolls back all erasure if the final audit insert fails', async () => {
    await archive()
    const before = await snapshot(a.tenantId)
    await withOwner(async tx => {
      await tx.execute(sql`alter table public.platform_audit_event add constraint test_reject_tenant_delete
        check (operation <> 'tenant.delete') not valid`)
      await expect(tx.transaction(sp => sp.execute(eraseSql()))).rejects.toMatchObject({
        cause: { code: '23514', constraint_name: 'test_reject_tenant_delete' },
      })
      await tx.execute(sql`alter table public.platform_audit_event drop constraint test_reject_tenant_delete`)
    }, a.tenantId)
    expect(await snapshot(a.tenantId)).toEqual(before)
  })

  it('rejects unclassified platform audit operations and runtime audit changes', async () => {
    const add = (operation: string) => sql`insert into public.platform_audit_event (actor_kind, operation)
      values ('person', ${operation})`
    await expect(withOwner(tx => tx.execute(add('tenant.unknown')))).rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(withOwner(tx => tx.execute(sql`insert into public.platform_audit_event
      (actor_kind, actor_user_id, operation, object_type) values ('platform', ${a.platformAdminId}, 'tenant.delete', 'tenant')`)))
      .rejects.toMatchObject({ cause: { code: '23514' } })
    await expect(withTenant(a.tenantId, tx => tx.execute(sql`delete from public.tenant_audit_event`)))
      .rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(withTenant(a.tenantId, tx => tx.execute(sql`update public.platform_audit_event set details = '{}'`)))
      .rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('keeps the last active administrator protection on normal revocation', async () => {
    await archive()
    await expect(withTenant(a.tenantId, tx => tx.execute(sql`
      select public.set_membership_status_guarded(${a.adminId}::uuid, 'deactivated')`)))
      .rejects.toMatchObject({ cause: { code: 'P0001', message: 'last_active_administrator' } })
  })

  it('holds the policy lock and prevents a waiting write from recreating tenant data', async () => {
    await archive()
    let finish!: () => void
    const waitForWriter = new Promise<void>(resolve => { finish = resolve })
    let erased!: () => void
    const deletionReady = new Promise<void>(resolve => { erased = resolve })
    const deletion = withPlatform(async tx => {
      await tx.execute(eraseSql())
      erased()
      await waitForWriter
    }, a.tenantId)
    let write: Promise<unknown> | undefined
    let writerPid: number | undefined
    try {
      await Promise.race([deletion, deletionReady])
      const [lock] = await withTenant(a.tenantId, tx => tx.execute<{ acquired: boolean }>(sql`
        select pg_try_advisory_xact_lock(-${a.tenantId}::bigint) as acquired`))
      expect(lock.acquired).toBe(false)
      write = withTenant(a.tenantId, async tx => {
        const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
        writerPid = row.pid
        return tx.execute(sql`insert into public.role (description) values ('waiting writer')`)
      }).catch(error => error)
      await expect.poll(async () => {
        if (writerPid === undefined) return false
        const [row] = await withOwner(tx => tx.execute<{ waiting: boolean }>(sql`
          select exists (select 1 from pg_catalog.pg_locks
            where pid = ${writerPid} and locktype = 'advisory' and not granted) as waiting`))
        return row.waiting
      }, { timeout: 2_000, interval: 20 }).toBe(true)
    } finally {
      finish()
      await deletion
    }
    expect(await write).toMatchObject({ cause: { code: '23503' } })
    expect((await snapshot(a.tenantId)).tables).toEqual(ownedTables.map(() => []))
  })

  it('rolls back a concurrent archive restore, then restores without reintroducing its erased platform origin', async () => {
    await withOwner(async tx => {
      await tx.execute(sql`update public.users set last_tenant_id = ${a.tenantId} where id = ${a.memberId}`)
      await tx.execute(sql`insert into public.tenant_audit_event (actor_kind, operation)
        values ('platform', 'support.enter')`)
    }, a.tenantId)
    const actor = await resolveActor(a.tenantId, a.adminId)
    if (!actor) throw new Error('Missing source administrator')
    const bytes = await prepareTenantExport(actor, new AbortController().signal)
    const fixtureArchive = parseTenantArchive(JSON.parse(new TextDecoder().decode(bytes)))
    const userMap = { [a.adminId]: a.adminId, [a.memberId]: a.memberId }
    await archive()

    const slug = `zzz-erase-restore-${unique()}`
    const restore = () => withOwner(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`)
      const [row] = await tx.execute<{ id: string }>(sql`
        select app_private.restore_tenant_archive(
          ${JSON.stringify(fixtureArchive)}::jsonb, ${slug}, 'Restored after erasure',
          ${JSON.stringify(userMap)}::jsonb, ${a.platformAdminId}::uuid
        )::text as id`)
      return tenantIdForTest(Number(row.id))
    })
    const lastTenantSequenceValue = async () => {
      const [row] = await withOwner(tx => tx.execute<{ id: string }>(sql`select last_value::text as id from public.s_id_tenant`))
      return tenantIdForTest(Number(row.id))
    }

    try {
      const before = await lastTenantSequenceValue()
      await withPlatform(async tx => {
        await tx.execute(sql`select app_private.lock_tenant_policy()`)
        await tx.execute(sql`select id from public.tenant where id = ${a.tenantId} for update`)
        // The barrier stays held until restore rejects. A blocking lock would hit
        // lock_timeout and report a different message, even though the SQLSTATE is also 55P03.
        await expect(restore()).rejects.toMatchObject({
          cause: { code: '55P03', message: 'could not obtain lock on row in relation "tenant"' },
        })
        const rolledBackId = await lastTenantSequenceValue()
        expect(rolledBackId).toBeGreaterThan(before)
        expect(await snapshot(rolledBackId)).toEqual({ tables: ownedTables.map(() => []), tenant: [], hosts: [], audit: [] })
        expect(await withOwner(owner => owner.execute(sql`select last_tenant_id::text from public.users where id = ${a.memberId}`)))
          .toEqual([{ last_tenant_id: String(a.tenantId) }])
        await tx.execute(eraseSql())
      }, a.tenantId)

      const destination = await restore()
      expect(await withOwner(tx => tx.execute(sql`select last_tenant_id from public.users where id = ${a.memberId}`)))
        .toEqual([{ last_tenant_id: null }])
      const restored = await snapshot(destination)
      expect(restored.tenant).toEqual([{ row: expect.objectContaining({ slug, status: 'suspended' }) }])
      expect(restored.tables[ownedTables.indexOf('tenant_membership')]).toEqual(expect.arrayContaining([
        { row: expect.objectContaining({ user_id: a.memberId }) },
        { row: expect.objectContaining({ user_id: a.adminId }) },
      ]))
      expect(restored.tables[ownedTables.indexOf('tenant_audit_event')]).toContainEqual({
        row: expect.objectContaining({ operation: 'support.enter', origin: 'restored', source_tenant_id: String(a.tenantId) }),
      })
      expect(restored.audit).toEqual([{ row: expect.objectContaining({
        id_tenant: destination, object_id: String(destination), operation: 'tenant.restore', source_tenant_id: null, details: {},
      }) }])
    } finally {
      const [row] = await withOwner(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where slug = ${slug}`))
      if (row) await deleteTenantForTest(tenantIdForTest(Number(row.id)))
    }
  })
})
