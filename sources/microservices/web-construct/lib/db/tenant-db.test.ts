import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { toTenantId } from '@/lib/tenancy/tenant-id'
import type { Database } from './client'
import { createTenantAccess } from './tenant-db'

function fakeDatabase() {
  const executed: SQL[] = []
  const configs: unknown[] = []
  const tx = { execute: async (query: SQL) => { executed.push(query); return [] } }
  const database = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>, config?: unknown) => {
      configs.push(config)
      return fn(tx)
    },
  } as unknown as Database
  return { database, executed, configs }
}

const dialect = new PgDialect()

describe('withTenant', () => {
  it('sets the tenant as a transaction-local parameter before running the callback', async () => {
    const { database, executed } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    const result = await withTenant(toTenantId(7), async () => 'done')
    expect(result).toBe('done')
    expect(executed).toHaveLength(1)
    const rendered = dialect.sqlToQuery(executed[0])
    expect(rendered.sql).toBe("select set_config('app.tenant_id', $1, true)")
    expect(rendered.params).toEqual(['7'])
  })

  it('passes the transaction options through unchanged', async () => {
    const { database, configs } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    await withTenant(toTenantId(1), async () => null, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    expect(configs).toEqual([{ isolationLevel: 'repeatable read', accessMode: 'read only' }])
  })

  it('refuses a tenant id that was not built by toTenantId', async () => {
    const { database, executed } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    await expect(withTenant(0 as never, async () => null)).rejects.toThrow('invalid tenant id')
    expect(executed).toHaveLength(0)
  })
})

describe('withGlobal', () => {
  it('opens a transaction without setting any tenant', async () => {
    const { database, executed } = fakeDatabase()
    const { withGlobal } = createTenantAccess(database)
    await withGlobal(async () => null)
    expect(executed).toHaveLength(0)
  })
})
