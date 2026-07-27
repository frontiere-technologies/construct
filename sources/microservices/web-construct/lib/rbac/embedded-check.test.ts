import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkEmbeddable, isHttpUrl } from './embedded-check'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('returns false when X-Frame-Options is comma-combined (repeated header sent as "DENY, DENY")', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'DENY, DENY' } }))
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

  it('returns true when CSP frame-ancestors explicitly lists this app\'s own origin', async () => {
    vi.stubEnv('AUTH_URL', 'https://app.example.com')
    mockFetchOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Security-Policy': 'frame-ancestors https://app.example.com' },
    }))
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

  it('returns false for a loopback literal (127.0.0.1) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('http://127.0.0.1/x')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for a link-local literal (169.254.169.254, cloud metadata) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('http://169.254.169.254/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when the response is a 3xx redirect', async () => {
    mockFetchOnce(new Response(null, { status: 302 }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })
})

describe('isHttpUrl', () => {
  it('accepts https URLs', () => {
    expect(isHttpUrl('https://x')).toBe(true)
  })

  it('accepts http URLs', () => {
    expect(isHttpUrl('http://x')).toBe(true)
  })

  it('is case-insensitive on the scheme', () => {
    expect(isHttpUrl('HTTPS://x')).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(isHttpUrl('data:text/html,x')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isHttpUrl('')).toBe(false)
  })

  it('rejects a whitespace-padded URL', () => {
    expect(isHttpUrl('  https://x')).toBe(false)
  })
})
