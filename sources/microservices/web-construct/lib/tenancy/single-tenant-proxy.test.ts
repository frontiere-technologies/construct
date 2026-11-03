import { NextRequest, type NextFetchEvent } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import proxy from '@/proxy'

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
// Solo l'autorità sull'host è reale: questi test del proxy non aprono il database.
vi.mock('@/lib/db/tenant-db', () => ({ withGlobal: vi.fn(), withTenant: vi.fn() }))

beforeEach(() => {
  vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'single')
  vi.stubEnv('AUTH_URL', 'https://canonical.example')
  vi.stubEnv('TRUST_FORWARDED_HOST', 'false')
  mocks.auth.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

function request(path: string, host = 'canonical.example', forwarded?: string) {
  return new NextRequest(`https://${host}${path}`, { headers: { host, ...(forwarded ? { 'x-forwarded-host': forwarded } : {}) } })
}

const event = {} as NextFetchEvent

describe('single installation proxy', () => {
  it.each(['/platform', '/platform/tenants', '/select-tenant', '/select-tenant/nested'])('closes %s before auth redirects can reach the selector or console', async path => {
    expect((await proxy(request(path), event))?.status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it.each(['b.example', 'unknown.example'])('rejects noncanonical host %s, even with a client forwarded header', async host => {
    expect((await proxy(request('/', host, 'canonical.example'), event))?.status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('keeps normal authentication on the canonical host', async () => {
    await proxy(request('/'), event)
    expect(mocks.auth).toHaveBeenCalledTimes(1)
  })

  it('uses the configured legacy canonical origin when AUTH_URL is absent', async () => {
    vi.stubEnv('AUTH_URL', undefined)
    vi.stubEnv('NEXTAUTH_URL', 'https://canonical.example')
    await proxy(request('/'), event)
    expect(mocks.auth).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing canonical configuration', async () => {
    vi.stubEnv('AUTH_URL', undefined)
    vi.stubEnv('NEXTAUTH_URL', undefined)
    await expect(proxy(request('/'), event)).rejects.toThrow('server_configuration')
  })

  it('restores multi admission to dedicated hosts and the console', async () => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'multi')
    await proxy(request('/platform', 'b.example'), event)
    expect(mocks.auth).toHaveBeenCalledTimes(1)
  })
})
