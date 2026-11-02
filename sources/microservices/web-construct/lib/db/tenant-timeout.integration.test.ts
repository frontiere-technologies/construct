import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { closeOwner, withOwner } from './testing'
import { createDatabase, type Database } from './client'
import { createTenantAccess } from './tenant-db'

describeIntegration('tenant transaction query timeout', () => {
  afterAll(closeOwner)

  it('cancels pg_sleep and rolls back writes, then reuses the connection for B without any residual timeout', async () => {
    const a = await createPolicyFixture('timeout-a')
    const b = await createPolicyFixture('timeout-b')
    const client = createDatabase(process.env.TEST_DATABASE_URL!, { max: 1 })
    const access = createTenantAccess(client.database)
    try {
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set query_timeout_ms = 80`), a.tenantId)
      await expect(access.withTenant(a.tenantId, async tx => {
        await tx.execute(sql`insert into public.role (id_role_type, description) values (2, 'rolled back timeout')`)
        await tx.execute(sql`select pg_sleep(0.25)`)
      })).rejects.toMatchObject({ cause: { code: '57014' } })
      const [written] = await access.withTenant(a.tenantId, tx => tx.execute<{ count: number }>(sql`select count(*)::int as count from public.role where description = 'rolled back timeout'`))
      expect(written.count).toBe(0)
      const [result] = await access.withTenant(b.tenantId, tx => tx.execute<{ timeout: string; slept: string }>(sql`select current_setting('statement_timeout') as timeout, pg_sleep(0.15) as slept`))
      expect(result.timeout).toBe('0')
      const [pooled] = await access.withGlobal(tx => tx.execute<{ timeout: string }>(sql`select current_setting('statement_timeout') as timeout`))
      expect(pooled.timeout).toBe('0')
    } finally { await client.close(); await a.close(); await b.close() }
  })

  it('never relaxes the stricter timeout already set on the transaction connection', async () => {
    const f = await createPolicyFixture('timeout-limit')
    const client = createDatabase(process.env.TEST_DATABASE_URL!, { max: 1 })
    // Model a preconfigured connection using a local transaction setting.
    const configured = {
      transaction: (fn: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) =>
        client.database.transaction(async tx => {
          await tx.execute(sql`set local statement_timeout = '60ms'`)
          return fn(tx)
        }, options),
    } as Database
    try {
      await withOwner(tx => tx.execute(sql`update public.tenant_platform_policy set query_timeout_ms = 2000`), f.tenantId)
      await expect(createTenantAccess(configured).withTenant(f.tenantId, tx => tx.execute(sql`select pg_sleep(0.2)`)))
        .rejects.toMatchObject({ cause: { code: '57014' } })
    } finally { await client.close(); await f.close() }
  })
})
