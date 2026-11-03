import { afterAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { withTenant } from './tenant-db'
import { closeOwner, withOwner } from './testing'
import { tenant } from './schema'

describeIntegration('export executor cancellation and connection lifecycle', () => {
  afterAll(async () => {
    await closeOwner()
    const scopeAccess = await import('./tenant-export-scope')
    await scopeAccess.closeTenantExportExecutor()
  })

  it.each(['request abort', 'deadline timer'])('cancels an active query for %s, rolls back and recovers without a late cancel', async mode => {
    const f = await createPolicyFixture('export-cancel')
    const controller = new AbortController()
    let backend = 0
    let started!: () => void
    const running = new Promise<void>(resolve => { started = resolve })
    const scopeAccess = await import('./tenant-export-scope')
    const nativeTimeout = globalThis.setTimeout
    let deadline!: () => void
    let time = 0
    if (mode === 'deadline timer') {
      vi.spyOn(performance, 'now').mockImplementation(() => time)
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, milliseconds, ...args) => {
        if (milliseconds === 60_000) deadline = () => callback(...args)
        return nativeTimeout(callback, milliseconds, ...args)
      })
    }
    try {
      const operation = scopeAccess.withTenantExportScope(controller.signal, () => withTenant(f.tenantId, async tx => {
        const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
        backend = row.pid
        await tx.execute(sql`insert into public.tenant_audit_event (actor_kind, operation, object_type) values ('person', 'role.create', 'cancellation-marker')`)
        started()
        await tx.execute(sql`select pg_sleep(15)`)
      }))
      await running
      // Barrier on the actual backend, with the test migration identity for statistics only.
      // There is no guessed delay between sending pg_sleep and cancelling it.
      const until = Date.now() + 2_000
      let sleeping = false
      while (Date.now() < until) {
        const [state] = await withOwner(async tx => {
          await tx.execute(sql`set local role none`)
          return tx.execute<{ sleeping: boolean }>(sql`select exists(select 1 from pg_stat_activity
            where pid = ${backend} and state = 'active' and query like '%pg_sleep(15)%' and wait_event = 'PgSleep') as sleeping`)
        })
        if (state.sleeping) { sleeping = true; break }
        await new Promise(resolve => nativeTimeout(resolve, 10))
      }
      expect(sleeping).toBe(true)
      if (mode === 'deadline timer') { time = 60_000; deadline() }
      else controller.abort(new Error('request cancelled'))
      await expect(operation).rejects.toThrow()
      const [state] = await withOwner(tx => tx.execute<{ present: boolean; marker: number }>(sql`select
        exists(select 1 from pg_stat_activity where pid = ${backend}) as present,
        (select count(*)::int from public.tenant_audit_event where object_type = 'cancellation-marker') as marker`), f.tenantId)
      expect(state).toEqual({ present: false, marker: 0 })
      vi.restoreAllMocks()
      for (let index = 0; index < 3; index++) {
        const rows = await scopeAccess.withTenantExportScope(new AbortController().signal, () => withTenant(f.tenantId, tx => tx.execute<{ n: number }>(sql`select 7::int as n`)))
        expect(rows[0].n).toBe(7)
      }
    } finally { vi.restoreAllMocks(); controller.abort(); await f.close(); await scopeAccess.closeTenantExportExecutor() }
  })

  it('removes an aborted admission from the queue without cancelling the current tenant', async () => {
    const a = await createPolicyFixture('export-queue')
    const scopeAccess = await import('./tenant-export-scope')
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const active = new Promise<void>(resolve => { entered = resolve })
    try {
      const first = scopeAccess.withTenantExportScope(new AbortController().signal, () => withTenant(a.tenantId, async tx => {
        entered()
        await held
        return tx.execute<{ n: number }>(sql`select 1::int as n`)
      }))
      await active
      const controller = new AbortController()
      const waiting = scopeAccess.withTenantExportScope(controller.signal, () => withTenant(a.tenantId, tx => tx.execute(sql`select 2`)))
      controller.abort(new Error('queued request cancelled'))
      await expect(waiting).rejects.toThrow('queued request cancelled')
      release()
      expect((await first)[0].n).toBe(1)
    } finally { release(); await a.close(); await scopeAccess.closeTenantExportExecutor() }
  })

  it.each([[0, 1_000], [200, 200]])('bounds each statement by remaining time without widening current %s ms', async (configured, expected) => {
    const f = await createPolicyFixture('export-timeout')
    const scopeAccess = await import('./tenant-export-scope')
    let time = 0
    try {
      vi.spyOn(performance, 'now').mockImplementation(() => time)
      const rows = await scopeAccess.withTenantExportScope(new AbortController().signal, () => withTenant(f.tenantId, async tx => {
        await tx.execute(sql`select set_config('statement_timeout', ${String(configured)}, true)`)
        time = 59_000
        return tx.execute<{ timeout: number }>(sql`select (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::int as timeout`)
      }))
      expect(rows[0].timeout).toBe(expected)
    } finally { vi.restoreAllMocks(); await f.close(); await scopeAccess.closeTenantExportExecutor() }
  })

  it('preserves the Drizzle timestamp decoder used by ordinary tenant transactions', async () => {
    const f = await createPolicyFixture('export-decode')
    const scopeAccess = await import('./tenant-export-scope')
    try {
      const [row] = await scopeAccess.withTenantExportScope(new AbortController().signal,
        () => withTenant(f.tenantId, tx => tx.select({ created: tenant.createdAt }).from(tenant).where(eq(tenant.id, f.tenantId))))
      expect(typeof row.created).toBe('string')
      expect(row.created).toMatch(/^\d{4}-\d{2}-\d{2}/)
    } finally { await f.close(); await scopeAccess.closeTenantExportExecutor() }
  })
})
