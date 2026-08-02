import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.error }) }))

const { GET: live } = await import('@/app/api/health/live/route')
const { GET: ready } = await import('@/app/api/health/ready/route')

describe('health routes', () => {
  beforeEach(() => {
    mocks.execute.mockReset()
    mocks.error.mockReset()
  })

  it('reports process liveness without querying the database', async () => {
    const response = await live()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('reports readiness after the database probe succeeds', async () => {
    mocks.execute.mockResolvedValue([{ ok: 1 }])
    const response = await ready()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('reports an unavailable payload without leaking the database error', async () => {
    mocks.execute.mockRejectedValue(new Error('password authentication failed for secret-user'))
    const response = await ready()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unavailable' })
  })
})
