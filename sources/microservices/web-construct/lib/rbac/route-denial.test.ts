import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

const { deniedActor } = await import('./route-denial')

describe('deniedActor', () => {
  beforeEach(() => {
    mocks.logError.mockReset()
  })

  it('turns a refusal into null without logging: a missing permission is not a fault', () => {
    expect(deniedActor(new Error('Unauthorized'))).toBeNull()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('turns any other failure into null too, but logs it first', () => {
    const err = new Error('connect ECONNREFUSED')
    expect(deniedActor(err)).toBeNull()
    expect(mocks.logError).toHaveBeenCalledWith({ err }, expect.any(String))
  })

  it('logs a thrown value that is not an Error', () => {
    expect(deniedActor('boom')).toBeNull()
    expect(mocks.logError).toHaveBeenCalledWith({ err: 'boom' }, expect.any(String))
  })
})
