import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { Actor } from '@/lib/rbac/actor'

const mocks = vi.hoisted(() => ({ require: vi.fn(), prepare: vi.fn(), recheck: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-export-access', () => ({ requireTenantExporter: mocks.require, assertTenantExportStillAllowed: mocks.recheck }))
vi.mock('@/lib/tenancy/tenant-export-service', () => ({ prepareTenantExport: mocks.prepare }))

const actor: Actor = { tenantId: tenantIdForTest(42), userId: 'person', roleIds: [], isAdmin: true, isPlatformAdmin: false, features: new Set(), canManageSupportConsent: true, permissions: new Set() }

describe('authenticated tenant archive HTTP delivery', () => {
  beforeEach(() => {
    mocks.require.mockReset().mockResolvedValue(actor)
    mocks.prepare.mockReset().mockResolvedValue(new Uint8Array([123, 125]))
    mocks.recheck.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('prepares privately and rechecks authorization before delivering a no-store attachment', async () => {
    const order: string[] = []
    mocks.require.mockImplementation(async () => { order.push('guard'); return actor })
    mocks.prepare.mockImplementation(async () => { order.push('snapshot'); return new Uint8Array([123, 125]) })
    mocks.recheck.mockImplementation(async () => { order.push('fresh guard') })
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost:3001/api/tenant/export'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="tenant-42-/)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.text()).toBe('{}')
    expect(order).toEqual(['guard', 'snapshot', 'fresh guard'])
  })

  it.each(['initial guard', 'final guard', 'preparation'])('delivers no file when %s fails', async phase => {
    const fail = async () => { throw new Error('Unauthorized') }
    if (phase === 'initial guard') mocks.require.mockImplementation(fail)
    else if (phase === 'final guard') mocks.recheck.mockImplementation(fail)
    else mocks.prepare.mockImplementation(fail)
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost:3001/api/tenant/export'))
    expect(response.status).toBe(403)
    expect(response.headers.has('Content-Disposition')).toBe(false)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    if (phase === 'initial guard') expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('includes both guards and response construction in one total deadline', async () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    mocks.require.mockImplementation(async () => { clock = 10_000; return actor })
    mocks.prepare.mockImplementation(async () => { clock = 59_999; return new Uint8Array([123, 125]) })
    mocks.recheck.mockImplementation(async () => { clock = 60_000 })
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost:3001/api/tenant/export'))
    expect(response.status).toBe(408)
    expect(response.headers.has('Content-Disposition')).toBe(false)
  })

  it('delivers no file if the client aborts after preparation', async () => {
    const abort = new AbortController()
    mocks.prepare.mockImplementation(async () => { abort.abort(); return new Uint8Array([123, 125]) })
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost:3001/api/tenant/export', { signal: abort.signal }))
    expect(response.ok).toBe(false)
    expect(response.headers.has('Content-Disposition')).toBe(false)
  })
})
