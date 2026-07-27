import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkEmbeddable } from './embedded-check'

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetchOnce(response: Response) {
  const fn = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('checkEmbeddable', () => {
  it('returns true when no blocking headers are present', async () => {
    mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('https://example.com')).toBe(true)
  })

  it('returns false when X-Frame-Options is DENY', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'DENY' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false when X-Frame-Options is SAMEORIGIN', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'SAMEORIGIN' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false when CSP frame-ancestors is \'none\'', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': "frame-ancestors 'none'" } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns true when CSP frame-ancestors allows *', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': 'frame-ancestors *' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(true)
  })

  it('falls back to GET when HEAD returns 405', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fn)
    expect(await checkEmbeddable('https://example.com')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[0][1]?.method).toBe('HEAD')
    expect(fn.mock.calls[1][1]?.method).toBe('GET')
  })

  it('returns false when fetch throws (network error / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false for a non-http(s) URL without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('javascript:alert(1)')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})
