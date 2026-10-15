import { expect, it } from 'vitest'
import { eq, isNotNull, sql } from 'drizzle-orm'
import { role, tenant } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant } from './testing'

describeIntegration('tenant schema', () => {
  it('holds the default tenant', async () => {
    const rows = await withGlobal(tx => tx.select().from(tenant).where(eq(tenant.slug, 'default')))
    expect(rows.map(row => [row.id, row.status])).toEqual([[1, 'active']])
  })

  it('marks the two system roles of the default tenant by key', async () => {
    const rows = await withTenant(defaultTestTenant(), tx => tx
      .select({ idRole: role.idRole, systemKey: role.systemKey })
      .from(role)
      .where(isNotNull(role.systemKey))
      .orderBy(role.idRole))
    expect(rows).toEqual([{ idRole: 0, systemKey: 'REGISTERED' }, { idRole: 1, systemKey: 'TENANT_ADMIN' }])
  })

  it('stamps new rows with the tenant of the transaction', async () => {
    const stamped = await withTenant(defaultTestTenant(), tx =>
      tx.execute<{ id: string }>(sql`select app_private.current_tenant_id()::text as id`))
    expect(stamped[0].id).toBe('1')
  })

  it('refuses to name a tenant when none is set', async () => {
    await expect(withGlobal(tx => tx.execute(sql`select app_private.current_tenant_id()`)))
      .rejects.toSatisfy((error: { cause?: { code?: string; message?: string } }) =>
        error.cause?.code === '42501' && /tenant context missing/.test(error.cause?.message ?? ''))
  })
})
