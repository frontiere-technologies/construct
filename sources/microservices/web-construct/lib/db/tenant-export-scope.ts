import { AsyncLocalStorage } from 'node:async_hooks'
import { Socket } from 'node:net'
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
  reserve: () => Promise<postgres.ReservedSql>
  close: () => Promise<void>
}

const CONNECT_TIMEOUT_SECONDS = 5
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
  await current?.close()
}

/** postgres.js replaces the raw socket's listeners when upgrading it to TLS. Observe the
 * transport's close event without depending on a listener that the upgrade removes. */
class ExportSocket extends Socket {
  host?: string
  port?: number
  private notifyClosed!: () => void
  readonly transportClosed = new Promise<void>(resolve => { this.notifyClosed = resolve })

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'close') this.notifyClosed()
    return super.emit(event, ...args)
  }
}

type SocketOptions = Pick<postgres.ParsedOptions, 'host' | 'port' | 'path' | 'ssl'> & { sslnegotiation?: string }

function usesDirectTls({ ssl, sslnegotiation }: Pick<SocketOptions, 'ssl' | 'sslnegotiation'>): boolean {
  return Boolean(ssl && sslnegotiation === 'direct')
}

function createExecutor(): ExportExecutor {
  const sockets = new Set<ExportSocket>()
  let retired = false
  let reserving = false
  let activeHost = 0
  let nextHost = 0
  let retirement: Promise<void> | undefined
  const options = {
    max: 1, prepare: false, connect_timeout: CONNECT_TIMEOUT_SECONDS,
    // Public postgres.js socket factory. Only the TCP/Unix dial belongs to this adapter;
    // the driver still owns SSL negotiation, certificate validation and PostgreSQL startup.
    socket: (connection: SocketOptions) => {
      if (retired) throw new Error('tenant export executor retired')
      const { host, port, path } = connection
      if (reserving) {
        activeHost = nextHost
        nextHost = (nextHost + 1) % port.length
      }
      // A CancelRequest is a separate connection, directed to the same backend endpoint.
      const socket = new ExportSocket()
      sockets.add(socket)
      void socket.transportClosed.then(() => sockets.delete(socket))
      const dial = () => {
        try {
          if (path) socket.connect(path)
          else {
            socket.host = host[activeHost] // SNI input used by the driver when it upgrades to TLS.
            socket.port = port[activeHost]
            socket.connect(socket.port, socket.host)
          }
        } catch (error) {
          socket.destroy()
          throw error
        }
      }
      if (!usesDirectTls(connection)) {
        dial()
        return socket
      }
      // Unlike SSLRequest, direct TLS wraps the socket as soon as the factory resolves.
      // Wait for the winning TCP handle after Node's address-family fallback.
      return new Promise<ExportSocket>((resolve, reject) => {
        // Startup has the reserve timer below. A separate direct-TLS CancelRequest has
        // no reserve, so bound its whole transport lifetime independently from its own dial.
        const cancelTimeout = reserving ? undefined : setTimeout(() => socket.destroy(), CONNECT_TIMEOUT_SECONDS * 1000)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
        void socket.transportClosed.then(() => {
          clearTimeout(cancelTimeout)
          reject(new Error('tenant export TCP transport closed'))
        })
        dial()
      })
    },
  }
  const client = postgres(resolveDatabaseUrl(process.env), options)
  // Apply Drizzle's codecs to the real connection as well as to its transaction adapter.
  drizzle(client)
  function close(): Promise<void> {
    if (retirement) return retirement
    // Gate first: end() settles driver waiters but may leave a retry callback scheduled.
    retired = true
    retirement = (async () => {
      try { await client.end({ timeout: 0 }) } finally {
        const transports = [...sockets]
        for (const socket of transports) socket.destroy()
        await Promise.all(transports.map(socket => socket.transportClosed))
      }
    })()
    return retirement
  }
  return {
    async reserve() {
      reserving = true
      let startupCleanup: Promise<void> | undefined
      // The driver starts its own timer after an async factory resolves. Keep one budget
      // from before DNS/TCP through TLS and PostgreSQL startup, with cleanup before release.
      const deadline = usesDirectTls(client.options) ? performance.now() + CONNECT_TIMEOUT_SECONDS * 1000 : undefined
      const timer = deadline !== undefined ? setTimeout(function onStartupTimeout() {
        startupCleanup = close()
      }, CONNECT_TIMEOUT_SECONDS * 1000) : undefined
      try {
        const connection = await client.reserve()
        if (deadline !== undefined && performance.now() >= deadline) startupCleanup ??= close()
        if (startupCleanup) throw new Error('tenant export startup timeout')
        return connection
      } catch (error) {
        if (startupCleanup) throw new Error('tenant export startup timeout')
        throw error
      } finally {
        clearTimeout(timer)
        reserving = false
        await startupCleanup
      }
    },
    close,
  }
}

async function begin<T>(scope: ExportScope, work: (client: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const release = await admit(scope)
  let reserved: postgres.ReservedSql | undefined
  let reserving = false
  let closing: Promise<void> | undefined
  const active = new Set<PromiseLike<unknown> & { cancel(): void }>()
  const abort = () => {
    for (const query of active) query.cancel()
    if (reserving) closing = closeTenantExportExecutor()
  }
  scope.controller.signal.addEventListener('abort', abort)
  try {
    check(scope)
    const pool = executor ??= createExecutor()
    reserving = true
    try {
      reserved = await pool.reserve()
    } catch (error) {
      // A failed startup can leave the driver's retry queued even without a request abort.
      closing ??= closeTenantExportExecutor()
      throw error
    } finally { reserving = false }
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
