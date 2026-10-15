import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { Database } from './client'
import { createTenantAccess } from './tenant-db'

const mocks = vi.hoisted(() => ({ logError: vi.fn() }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

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
    const result = await withTenant(tenantIdForTest(7), async () => 'done')
    expect(result).toBe('done')
    expect(executed).toHaveLength(1)
    const rendered = dialect.sqlToQuery(executed[0])
    expect(rendered.sql).toBe("select set_config('app.tenant_id', $1, true)")
    expect(rendered.params).toEqual(['7'])
  })

  it('passes the transaction options through unchanged', async () => {
    const { database, configs } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    await withTenant(tenantIdForTest(1), async () => null, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    expect(configs).toEqual([{ isolationLevel: 'repeatable read', accessMode: 'read only' }])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s, a tenant id that was not built by toTenantId, before talking to the database',
    async value => {
      const { database, executed, configs } = fakeDatabase()
      const { withTenant } = createTenantAccess(database)
      await expect(withTenant(value as never, async () => null)).rejects.toThrow('invalid tenant id')
      expect(executed).toHaveLength(0)
      expect(configs).toHaveLength(0)
    },
  )
})

describe('withGlobal', () => {
  it('opens a transaction without setting any tenant', async () => {
    const { database, executed } = fakeDatabase()
    const { withGlobal } = createTenantAccess(database)
    await withGlobal(async () => null)
    expect(executed).toHaveLength(0)
  })
})

describe('the 42501 boundary log', () => {
  beforeEach(() => mocks.logError.mockReset())

  function failingDatabase(error: unknown) {
    return { transaction: async () => { throw error } } as unknown as Database
  }
  const boundary = Object.assign(new Error('tenant context missing'), { code: '42501' })
  const plainDenied = Object.assign(new Error('permission denied for table permission'), { code: '42501' })

  it('logs a tenant boundary violation for a 42501 "tenant context missing", direct or as the cause', async () => {
    const wrapped = Object.assign(new Error('Failed query: select …'), { cause: boundary })
    for (const error of [boundary, wrapped]) {
      mocks.logError.mockReset()
      const { withTenant, withGlobal } = createTenantAccess(failingDatabase(error))
      await expect(withTenant(tenantIdForTest(1), async () => null)).rejects.toBe(error)
      expect(mocks.logError).toHaveBeenCalledTimes(1)
      expect(mocks.logError.mock.calls[0][1]).toBe('tenant boundary violation')
      mocks.logError.mockReset()
      await expect(withGlobal(async () => null)).rejects.toBe(error)
      expect(mocks.logError).toHaveBeenCalledTimes(1)
      expect(mocks.logError.mock.calls[0][1]).toBe('tenant table touched without a tenant')
    }
  })

  it('does not log a plain permission denied 42501 as a boundary violation, and still rethrows it', async () => {
    const wrapped = Object.assign(new Error('Failed query: update permission …'), { cause: plainDenied })
    for (const error of [plainDenied, wrapped]) {
      const { withTenant, withGlobal } = createTenantAccess(failingDatabase(error))
      await expect(withTenant(tenantIdForTest(1), async () => null)).rejects.toBe(error)
      await expect(withGlobal(async () => null)).rejects.toBe(error)
    }
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('rethrows any other error without logging', async () => {
    const other = Object.assign(new Error('boom'), { code: '23505' })
    const { withTenant } = createTenantAccess(failingDatabase(other))
    await expect(withTenant(tenantIdForTest(1), async () => null)).rejects.toBe(other)
    expect(mocks.logError).not.toHaveBeenCalled()
  })
})
