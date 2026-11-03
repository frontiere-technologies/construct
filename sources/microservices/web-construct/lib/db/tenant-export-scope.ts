import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { resolveDatabaseUrl } from '@/lib/test-database'
import { EXPORT_DEADLINE_MS } from '@/lib/tenancy/tenant-archive-types'
import type { Database } from './client'
import * as schema from './schema'

interface ExportScope {
  controller: AbortController
  deadline: number
}

const scopes = new AsyncLocalStorage<ExportScope>()
interface ExportExecutor {
  client: postgres.Sql
  waitForClose: () => Promise<void>
}

let executor: ExportExecutor | undefined
let occupied = false
const queue: { signal: AbortSignal; admit: () => void }[] = []

function check(scope: ExportScope): void {
  if (performance.now() >= scope.deadline && !scope.controller.signal.aborted) scope.controller.abort(new Error('tenant_export_deadline'))
  scope.controller.signal.throwIfAborted()
}

/** Monotonic total budget: includes both fresh guards, DB admission, serialization and Response. */
export async function withTenantExportScope<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const existing = scopes.getStore()
  if (existing) { check(existing); return work() }
  const scope: ExportScope = { controller: new AbortController(), deadline: performance.now() + EXPORT_DEADLINE_MS }
  const abort = () => scope.controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(() => scope.controller.abort(new Error('tenant_export_deadline')), EXPORT_DEADLINE_MS)
  try {
    return await scopes.run(scope, async () => {
      check(scope)
      const result = await work()
      check(scope)
      return result
    })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export function assertTenantExportActive(): void {
  const scope = scopes.getStore()
  if (!scope) throw new Error('tenant export scope missing')
  check(scope)
}

function admit(scope: ExportScope): Promise<() => void> {
  check(scope)
  return new Promise((resolve, reject) => {
    const signal = scope.controller.signal
    const abort = () => {
      const index = queue.indexOf(entry)
      if (index >= 0) queue.splice(index, 1)
      reject(signal.reason)
    }
    const entry = { signal, admit: () => {
      signal.removeEventListener('abort', abort)
      resolve(() => {
        const next = queue.shift()
        if (next) next.admit()
        else occupied = false
      })
    } }
    signal.addEventListener('abort', abort, { once: true })
    if (occupied) queue.push(entry)
    else { occupied = true; entry.admit() }
  })
}

/** Owns the dedicated executor lifecycle; shutdown and abort discard its connections. */
export async function closeTenantExportExecutor(): Promise<void> {
  const current = executor
  executor = undefined
  await current?.client.end({ timeout: 0 })
}

function createExecutor(): ExportExecutor {
  let notifyClosed: (() => void) | undefined
  const client = postgres(resolveDatabaseUrl(process.env), {
    max: 1, prepare: false, connect_timeout: 5,
    onclose: () => {
      notifyClosed?.()
      notifyClosed = undefined
    },
  })
  // Apply Drizzle's codecs to the real connection as well as to its transaction adapter.
  drizzle(client)
  return { client, waitForClose: () => new Promise(resolve => { notifyClosed = resolve }) }
}

async function begin<T>(scope: ExportScope, work: (client: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const release = await admit(scope)
  let reserved: postgres.ReservedSql | undefined
  let reservation: ExportExecutor | undefined
  let closing: Promise<void> | undefined
  const active = new Set<PromiseLike<unknown> & { cancel(): void }>()
  const abort = () => {
    for (const query of active) query.cancel()
    if (reservation) {
      // Forced end settles the driver's reserve waiter, but may resolve before a connecting
      // socket closes. Subscribe to this pool's actual close before ending it. Only the one
      // in-flight reserve has a close waiter; a settled reserve takes the normal cleanup path.
      const closed = reservation.waitForClose()
      closing = closeTenantExportExecutor().finally(() => closed)
    }
  }
  scope.controller.signal.addEventListener('abort', abort)
  try {
    check(scope)
    const pool = executor ??= createExecutor()
    reservation = pool
    try { reserved = await pool.client.reserve() } finally { reservation = undefined }
    check(scope)
    const connection = reserved
    const run = async (query: PromiseLike<unknown> & { cancel(): void }) => {
      active.add(query)
      try { return await query } finally { active.delete(query) }
    }
    const trackedUnsafe = (...args: Parameters<postgres.Sql['unsafe']>) => {
      check(scope)
      const query = connection.unsafe(...args)
      let execution: Promise<unknown> | undefined
      const start = () => execution ??= (async () => {
        check(scope)
        // SET TRANSACTION must precede every SELECT (including timeout configuration), otherwise
        // PostgreSQL would already have established the snapshot. COMMIT gets a fresh bound too.
        if (!/^\s*(begin\b|set transaction\b)/i.test(args[0])) {
          const remaining = Math.max(1, Math.floor(scope.deadline - performance.now()))
          await run(connection.unsafe(`select pg_catalog.set_config('statement_timeout',
            least(case when current_setting('statement_timeout')::interval = interval '0'
              then ${remaining} else ceil(extract(epoch from current_setting('statement_timeout')::interval) * 1000)::bigint end,
              ${remaining})::text, true)`))
        }
        // No new application query can start if abort arrives between configuration and execution.
        check(scope)
        return run(query)
      })()
      const pending = new Proxy(query, { get(target, key) {
        if (key === 'then') return start().then.bind(start())
        if (key === 'catch') return start().catch.bind(start())
        if (key === 'finally') return start().finally.bind(start())
        if (key === 'values') return () => { target.values(); return pending }
        if (key === 'raw') return () => { target.raw(); return pending }
        if (key === 'simple') return () => { target.simple(); return pending }
        if (key === 'execute') return () => { void start(); return pending }
        return Reflect.get(target, key)
      } })
      return pending
    }
    const transaction = new Proxy(connection, { get(target, key) {
      if (key === 'unsafe') return trackedUnsafe
      if (key === 'savepoint' || key === 'prepare') return () => { throw new Error('nested/prepared export transactions are unsupported') }
      return Reflect.get(target, key)
    } }) as unknown as postgres.TransactionSql
    await trackedUnsafe('begin')
    try {
      // SET TRANSACTION, tenant context and all application statements flow through unsafe too.
      const result = await work(transaction)
      check(scope)
      await trackedUnsafe('commit')
      check(scope)
      return result
    } catch (error) {
      // Cleanup is deliberately outside the deadline: never return while DB work is abandoned.
      await Promise.allSettled([...active])
      try { await connection.unsafe('rollback') } catch { await closeTenantExportExecutor() }
      throw error
    }
  } finally {
    scope.controller.signal.removeEventListener('abort', abort)
    try {
      await closing
      if (scope.controller.signal.aborted) {
        // A CancelRequest may be delayed. Never give this backend to the next export.
        await closeTenantExportExecutor()
      } else reserved?.release()
    } finally { release() }
  }
}

/** Only the application singleton consults this scope; ordinary clients/budgets are unchanged. */
export function scopedTenantExportDatabase(): Database | null {
  const scope = scopes.getStore()
  if (!scope) return null
  // Drizzle calls begin(callback). The public adapter supplies a reserved transaction whose
  // BEGIN/COMMIT/ROLLBACK remain visible, unlike postgres.begin()'s private tagged statements.
  const adapter = new Proxy({} as postgres.Sql, {
    get(_target, key) {
      if (key === 'begin') return (work: (client: postgres.TransactionSql) => Promise<unknown>) => begin(scope, work)
      if (key === 'options') return { parsers: {}, serializers: {} }
      return undefined
    },
  })
  return drizzle({ client: adapter, schema }) as Database
}
