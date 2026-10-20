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

function lazyDatabase(options: { failSetConfig?: boolean } = {}) {
  const events: string[] = []
  const executed: SQL[] = []
  let setConfigSettled = false
  const tx = {
    execute: (query: SQL) => ({
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        executed.push(query)
        events.push('set_config sent')
        const result = new Promise((resolve, reject) => setTimeout(() => {
          setConfigSettled = true
          if (options.failSetConfig) reject(new Error('set_config failed'))
          else resolve([])
        }, 5))
        return result.then(onFulfilled, onRejected)
      },
    }),
  }
  const database = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      try { return await fn(tx) } finally { events.push('transaction settled') }
    },
  } as unknown as Database
  return { database, events, executed, isSetConfigSettled: () => setConfigSettled }
}

describe('withTenant, set_config', () => {
  it('writes the verified tenant into the statement text, without parameters', async () => {
    const { database, executed } = lazyDatabase()
    const { withTenant } = createTenantAccess(database)
    await withTenant(tenantIdForTest(7), async () => 'done')
    const rendered = dialect.sqlToQuery(executed[0])
    expect(rendered.sql).toBe("select set_config('app.tenant_id', '7', true)")
    expect(rendered.params).toEqual([])
  })

  it('sends set_config before the callback starts, without waiting for its answer', async () => {
    const { database, events, isSetConfigSettled } = lazyDatabase()
    const { withTenant } = createTenantAccess(database)
    let settledWhenCallbackStarted: boolean | null = null
    await withTenant(tenantIdForTest(7), async () => {
      events.push('callback started')
      settledWhenCallbackStarted = isSetConfigSettled()
      return null
    })
    expect(events).toEqual(['set_config sent', 'callback started', 'transaction settled'])
    expect(settledWhenCallbackStarted).toBe(false)
  })

  it('surfaces a set_config failure to the caller', async () => {
    const { database } = lazyDatabase({ failSetConfig: true })
    const { withTenant } = createTenantAccess(database)
    await expect(withTenant(tenantIdForTest(7), async () => 'done')).rejects.toThrow('set_config failed')
  })

  it('does not end the transaction while the callback is still running, even if set_config fails first', async () => {
    const { database, events } = lazyDatabase({ failSetConfig: true })
    const { withTenant } = createTenantAccess(database)
    await expect(withTenant(tenantIdForTest(7), async () => {
      await new Promise(resolve => setTimeout(resolve, 40))
      events.push('callback done')
      return 'done'
    })).rejects.toThrow('set_config failed')
    expect(events).toEqual(['set_config sent', 'callback done', 'transaction settled'])
  })

  it('turns a synchronous throw of the callback into a rejection, with no unhandled rejection left behind', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const failing = lazyDatabase({ failSetConfig: true })
      await expect(createTenantAccess(failing.database).withTenant(tenantIdForTest(7), (() => {
        throw new Error('sync boom')
      }) as never)).rejects.toThrow('set_config failed')
      const healthy = lazyDatabase()
      await expect(createTenantAccess(healthy.database).withTenant(tenantIdForTest(7), (() => {
        throw new Error('sync boom')
      }) as never)).rejects.toThrow('sync boom')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('withTenant', () => {
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
