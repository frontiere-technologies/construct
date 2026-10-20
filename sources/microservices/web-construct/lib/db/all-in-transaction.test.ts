import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allInTransaction } from './all-in-transaction'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('allInTransaction', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
  })

  it('returns the values in order, with the tuple typing of Promise.all', async () => {
    const slow = deferred<string>()
    const pending = allInTransaction([slow.promise, Promise.resolve(2), 3] as const)
    slow.resolve('a')
    const [first, second, third] = await pending
    const typed: [string, number, number] = [first, second, third]
    expect(typed).toEqual(['a', 2, 3])
  })

  it('resolves an empty list to an empty list', async () => {
    expect(await allInTransaction([])).toEqual([])
  })

  it('does not settle while a sibling is still pending, then rejects with the first rejection', async () => {
    const failing = deferred<number>()
    const slow = deferred<number>()
    let settled = false
    const outcome = allInTransaction([failing.promise, slow.promise]).then(
      () => { settled = true; return 'resolved' },
      (error: unknown) => { settled = true; return error },
    )
    failing.reject(new Error('first'))
    // Un Promise.all avrebbe già rifiutato: qui il ramo lento è ancora in corso.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    slow.resolve(1)
    expect(await outcome).toEqual(new Error('first'))
  })

  it('rejects with the first rejection in time, not in position, once every branch has settled', async () => {
    const early = deferred<number>()
    const late = deferred<number>()
    const outcome = allInTransaction([late.promise, early.promise]).catch((error: unknown) => error)
    early.reject(new Error('early'))
    late.reject(new Error('late'))
    expect(await outcome).toEqual(new Error('early'))
  })

  it('leaves no unhandled rejection when several branches fail', async () => {
    const outcome = allInTransaction([
      Promise.reject(new Error('one')),
      Promise.reject(new Error('two')),
      Promise.resolve(3),
    ]).catch((error: unknown) => error)
    expect(await outcome).toEqual(new Error('one'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(unhandled).toEqual([])
  })

  it('does not start anything by itself: it only waits for what the caller started', async () => {
    const started = vi.fn(() => Promise.resolve(1))
    await allInTransaction([started(), started()])
    expect(started).toHaveBeenCalledTimes(2)
  })
})
