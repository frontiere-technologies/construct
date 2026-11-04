import { once } from 'node:events'
import { createServer, Socket, type TcpSocketConnectOpts } from 'node:net'
import { afterAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { withTenant } from './tenant-db'
import { closeOwner, withOwner } from './testing'
import { tenant } from './schema'

function isCanonicalLocalFixture(): boolean {
  try {
    const target = new URL(process.env.TEST_DATABASE_URL ?? '')
    return target.hostname === '127.0.0.1' && target.port === '55432' && target.pathname === '/construct_test'
  } catch { return false }
}

describeIntegration('export executor cancellation and connection lifecycle', () => {
  afterAll(async () => {
    await closeOwner()
    const scopeAccess = await import('./tenant-export-scope')
    await scopeAccess.closeTenantExportExecutor()
  })

  it.skipIf(!isCanonicalLocalFixture())('keeps the slot until a cancelled PostgreSQL startup handshake has closed', async () => {
    const f = await createPolicyFixture('export-handshake')
    const scopeAccess = await import('./tenant-export-scope')
    const target = new URL(process.env.TEST_DATABASE_URL!)
    let peer: Socket | undefined
    const order: string[] = []
    let startup!: () => void
    const started = new Promise<void>(resolve => { startup = resolve })
    const server = createServer({ allowHalfOpen: true }, socket => {
      peer = socket
      socket.on('error', () => socket.destroy())
      order.push('first accepted')
      socket.once('data', startup) // Hold PostgreSQL startup, without retaining any protocol bytes.
      socket.once('end', () => { order.push('first disconnected'); socket.end() })
    })
    const controller = new AbortController()
    const operations: Promise<unknown>[] = []
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing local TCP endpoint')
      const stalled = new URL(target)
      stalled.port = String(address.port)
      vi.stubEnv('TEST_DATABASE_URL', stalled.toString())
      const query = (signal: AbortSignal) => scopeAccess.withTenantExportScope(signal,
        () => withTenant(f.tenantId, tx => tx.execute<{ n: number }>(sql`select 42::int as n`)))
      const first = query(controller.signal).then(() => 'completed', () => 'rejected')
      operations.push(first)
      await started
      controller.abort()
      vi.stubEnv('TEST_DATABASE_URL', target.toString())
      const second = scopeAccess.withTenantExportScope(new AbortController().signal, () => withTenant(f.tenantId, tx => {
        order.push('second entered')
        return tx.execute<{ n: number }>(sql`select 42::int as n`)
      }))
      operations.push(second)
      expect(await first).toBe('rejected')
      expect((await second)[0].n).toBe(42)
      expect(order).toEqual(['first accepted', 'first disconnected', 'second entered'])
    } finally {
      controller.abort()
      peer?.destroy()
      await Promise.allSettled(operations)
      await scopeAccess.closeTenantExportExecutor()
      await new Promise<void>(resolve => server.close(() => resolve()))
      vi.unstubAllEnvs()
      await f.close()
    }
  }, 15_000)

  it('prevents a queued reconnect from dialing after the startup executor has been discarded', async () => {
    const scopeAccess = await import('./tenant-export-scope')
    const controller = new AbortController()
    const nativeTimeout = globalThis.setTimeout
    const peers = new Set<Socket>()
    let accepted = 0
    let startup!: (socket: Socket) => void
    const started = new Promise<Socket>(resolve => { startup = resolve })
    const server = createServer(socket => {
      accepted++
      peers.add(socket)
      socket.on('error', () => socket.destroy())
      socket.once('data', () => startup(socket))
    })
    let endScheduled!: () => void
    let retryScheduled!: () => void
    const ending = new Promise<void>(resolve => { endScheduled = resolve })
    const retrying = new Promise<void>(resolve => { retryScheduled = resolve })
    let forceEnd: (() => void) | undefined
    let reconnect: (() => void) | undefined
    let operation: Promise<string> | undefined
    const parkedTimers: ReturnType<typeof setTimeout>[] = []
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing synthetic startup endpoint')
      vi.stubEnv('TEST_DATABASE_URL', `postgresql://fixture@127.0.0.1:${address.port}/fixture?backoff=0.5`)
      // Hold the two driver timers to reproduce the interleaving without relying on TCP timing.
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, milliseconds, ...args) => {
        if (controller.signal.aborted && callback.name === 'destroy' && milliseconds === 0 && !forceEnd) {
          forceEnd = () => { callback(...args) }
          endScheduled()
        } else if (controller.signal.aborted && callback.name === 'connect' && !reconnect) {
          reconnect = () => { callback(...args) }
          retryScheduled()
        } else return nativeTimeout(callback, milliseconds, ...args)
        const parked = nativeTimeout(() => undefined, 10_000)
        parkedTimers.push(parked)
        return parked
      })
      operation = scopeAccess.withTenantExportScope(controller.signal, () => scopeAccess.scopedTenantExportDatabase()!
        .transaction(async () => 'completed')).catch(() => 'rejected')
      const peer = await started
      controller.abort()
      await ending
      peer.resetAndDestroy()
      await retrying
      forceEnd?.()
      expect(await operation).toBe('rejected')
      const dial = vi.spyOn(Socket.prototype, 'connect')
      reconnect?.()
      // Flush the driver's async createSocket continuation. Check the dial itself as well as
      // the peer so that a slow accept cannot make this assertion pass accidentally.
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(dial).not.toHaveBeenCalled()
      expect(accepted).toBe(1)
    } finally {
      controller.abort()
      forceEnd?.()
      for (const socket of peers) socket.destroy()
      await operation
      await scopeAccess.closeTenantExportExecutor()
      for (const timer of parkedTimers) clearTimeout(timer)
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }, 10_000)

  it.each([
    { negotiation: 'postgres', end: 'abort' },
    { negotiation: 'direct', end: 'abort' },
    { negotiation: 'direct', end: 'startup timeout' },
    { negotiation: 'direct', end: 'pending DNS abort' },
  ])('closes a stalled $negotiation TLS handshake ($end) and preserves SNI', async ({ negotiation, end }) => {
    const scopeAccess = await import('./tenant-export-scope')
    const controller = new AbortController()
    let peer: Socket | undefined
    let observedSni = false
    let refusedFirstAddress = false
    let budgetBeforeDns = false
    let releaseLookup: (() => void) | undefined
    let lookupStarted!: () => void
    const lookupPending = new Promise<void>(resolve => { lookupStarted = resolve })
    const startupTimers: { duration: number | undefined; expire: () => void }[] = []
    let tlsStarted!: () => void
    let peerClosed!: () => void
    const handshake = new Promise<void>(resolve => { tlsStarted = resolve })
    const disconnected = new Promise<void>(resolve => { peerClosed = resolve })
    const server = createServer(socket => {
      peer = socket
      socket.on('error', () => socket.destroy())
      socket.once('close', peerClosed)
      const hello = (chunk: Buffer) => {
        observedSni = chunk.includes('localhost')
        tlsStarted()
      }
      if (negotiation === 'direct') socket.once('data', hello)
      else socket.once('data', () => {
        // Accept SSLRequest, then hold ClientHello without a certificate or authentication.
        socket.once('data', hello)
        socket.write('S')
      })
    })
    let operation: Promise<string> | undefined
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing synthetic TLS endpoint')
      if (end === 'startup timeout') {
        const nativeTimeout = globalThis.setTimeout
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, milliseconds, ...args) => {
          if (callback.name === 'onStartupTimeout') startupTimers.push({ duration: milliseconds, expire: () => callback(...args) })
          return nativeTimeout(callback, milliseconds, ...args)
        })
      }
      if (negotiation === 'direct') {
        const originalConnect = Socket.prototype.connect
        vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...args: unknown[]) {
          if (args[0] !== address.port || args[1] !== 'localhost') return Reflect.apply(originalConnect, this, args)
          this.once('connectionAttemptFailed', (ip: string) => { refusedFirstAddress = ip === '::1' })
          const options: TcpSocketConnectOpts = {
            port: address.port, host: 'localhost', autoSelectFamily: true,
            lookup: (_host, _options, callback) => {
              budgetBeforeDns = startupTimers.length === 1
              const answer = () => callback(null, [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }])
              if (end === 'pending DNS abort') {
                releaseLookup = answer
                lookupStarted()
              } else answer()
            },
          }
          return Reflect.apply(originalConnect, this, [options])
        })
      }
      const tls = negotiation === 'direct' ? '&sslnegotiation=direct' : ''
      vi.stubEnv('TEST_DATABASE_URL', `postgresql://fixture@localhost:${address.port}/fixture?sslmode=require${tls}`)
      operation = scopeAccess.withTenantExportScope(controller.signal, () => scopeAccess.scopedTenantExportDatabase()!
        .transaction(async () => 'completed')).catch((error: unknown) => error instanceof Error ? error.message : 'rejected')
      if (end === 'pending DNS abort') {
        await lookupPending
        controller.abort()
        expect(await operation).not.toBe('completed')
        releaseLookup?.()
        await new Promise<void>(resolve => setImmediate(resolve))
        expect(peer).toBeUndefined()
        return
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('TLS ClientHello did not reach the peer')), 1_000)
        void handshake.then(() => { clearTimeout(timeout); resolve() })
      })
      if (negotiation === 'direct') expect(refusedFirstAddress).toBe(true)
      expect(observedSni).toBe(true)
      if (end === 'startup timeout') {
        expect(budgetBeforeDns).toBe(true)
        expect(startupTimers.map(timer => timer.duration)).toEqual([5_000])
        startupTimers[0].expire()
        expect(await operation).toBe('tenant export startup timeout')
      } else {
        controller.abort()
        expect(await operation).not.toBe('completed')
      }
      await disconnected
    } finally {
      controller.abort()
      peer?.destroy()
      await operation
      await scopeAccess.closeTenantExportExecutor()
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }, 4_000)

  it('tries the next hostname after a direct TLS startup dial fails', async () => {
    const scopeAccess = await import('./tenant-export-scope')
    const controller = new AbortController()
    const order: string[] = []
    let peer: Socket | undefined
    let receiveHello!: (chunk: Buffer) => void
    const hello = new Promise<Buffer>(resolve => { receiveHello = resolve })
    const server = createServer(socket => {
      peer = socket
      socket.on('error', () => socket.destroy())
      let record = Buffer.alloc(0)
      socket.on('data', function readHello(chunk: Buffer) {
        record = Buffer.concat([record, chunk])
        if (record.length < 5 || record.length < 5 + record.readUInt16BE(3)) return
        socket.removeListener('data', readHello)
        receiveHello(record)
      })
    })
    let operation: Promise<unknown> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing synthetic TLS endpoint')
      const originalConnect = Socket.prototype.connect
      vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...args: unknown[]) {
        const hostname = args[1]
        if (args[0] !== address.port || (hostname !== 'first.test' && hostname !== 'second.test')) {
          return Reflect.apply(originalConnect, this, args)
        }
        order.push(hostname)
        if (hostname === 'first.test') {
          this.once('error', (error: NodeJS.ErrnoException) => { order.push(error.code ?? 'unknown TCP error') })
          this.once('close', () => { order.push('first closed') })
        }
        const options: TcpSocketConnectOpts = {
          port: address.port, host: hostname, autoSelectFamily: false,
          lookup: (_host, _options, callback) => {
            if (hostname === 'first.test') callback(null, '::1', 6)
            else callback(null, '127.0.0.1', 4)
          },
        }
        return Reflect.apply(originalConnect, this, [options])
      })
      vi.stubEnv('TEST_DATABASE_URL', `postgresql://fixture@first.test:${address.port},second.test:${address.port}/fixture?sslmode=require&sslnegotiation=direct`)
      operation = scopeAccess.withTenantExportScope(controller.signal, () => scopeAccess.scopedTenantExportDatabase()!
        .transaction(async () => 'completed')).catch(() => 'rejected')
      const chunk = await Promise.race([hello, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`second hostname received no ClientHello (${order.join(', ')})`)), 1_000)
      })])
      expect(order).toEqual(['first.test', 'ECONNREFUSED', 'first closed', 'second.test'])
      expect(chunk[0]).toBe(22) // TLS handshake record.
      expect(chunk[5]).toBe(1) // ClientHello.
      expect(chunk.includes('second.test')).toBe(true)
    } finally {
      clearTimeout(timeout)
      controller.abort()
      peer?.destroy()
      await operation
      await scopeAccess.closeTenantExportExecutor()
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }, 4_000)

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
