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

function check(
  url: string,
  dependencies?: Parameters<typeof checkEmbeddable>[1],
) {
  return checkEmbeddable(url, dependencies ?? {
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (target, method) => fetch(target, { method }),
  })
}

describe('checkEmbeddable', () => {
  it('rejects a hostname when DNS resolves it to a private address', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const result = await check('https://internal.example', {
      resolveHost: async () => [{ address: '10.0.0.8', family: 4 }],
      request,
    })
    expect(result).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a hostname if any DNS answer is reserved', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const result = await check('https://mixed.example', {
      resolveHost: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
      request,
    })
    expect(result).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('pins the validated DNS answer through the outbound request', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const result = await check('https://public.example/path', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      request,
    })
    expect(result).toBe(true)
    expect(request).toHaveBeenCalledWith(
      new URL('https://public.example/path'),
      'HEAD',
      { address: '93.184.216.34', family: 4 },
    )
  })

  it('returns true when no blocking headers are present', async () => {
    mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('https://example.com')).toBe(true)
  })

  it('returns false when X-Frame-Options is DENY', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'DENY' } }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false when X-Frame-Options is SAMEORIGIN', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'SAMEORIGIN' } }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false when X-Frame-Options is comma-combined (repeated header sent as "DENY, DENY")', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'DENY, DENY' } }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false when CSP frame-ancestors is \'none\'', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': "frame-ancestors 'none'" } }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns true when CSP frame-ancestors allows *', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': 'frame-ancestors *' } }))
    expect(await check('https://example.com')).toBe(true)
  })

  it('returns true when CSP frame-ancestors explicitly lists this app\'s own origin', async () => {
    vi.stubEnv('AUTH_URL', 'https://app.example.com')
    mockFetchOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Security-Policy': 'frame-ancestors https://app.example.com' },
    }))
    expect(await check('https://example.com')).toBe(true)
  })

  it('falls back to GET when HEAD returns 405', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fn)
    expect(await check('https://example.com')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[0][1]?.method).toBe('HEAD')
    expect(fn.mock.calls[1][1]?.method).toBe('GET')
  })

  it('returns false when fetch throws (network error / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false for a non-http(s) URL without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('javascript:alert(1)')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for a loopback literal (127.0.0.1) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://127.0.0.1/x')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for a link-local literal (169.254.169.254, cloud metadata) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://169.254.169.254/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when the response is a 3xx redirect', async () => {
    mockFetchOnce(new Response(null, { status: 302 }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false for an IPv4-mapped IPv6 loopback literal ([::ffff:127.0.0.1]) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://[::ffff:127.0.0.1]/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for an IPv4-mapped IPv6 cloud-metadata literal ([::ffff:a9fe:a9fe], 169.254.169.254) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://[::ffff:a9fe:a9fe]/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for the unspecified IPv6 address ([::]) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://[::]/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for the IPv4-mapped IPv6 form of 0.0.0.0 ([::ffff:0:0]) without calling fetch', async () => {
    // new URL('http://[::ffff:0:0]/').hostname === '[::ffff:0:0]'
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://[::ffff:0:0]/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for the IPv4-mapped IPv6 dotted-decimal form of 0.0.0.0 ([::ffff:0.0.0.0]) without calling fetch', async () => {
    // new URL('http://[::ffff:0.0.0.0]/').hostname === '[::ffff:0:0]' (canonicalized by the WHATWG URL parser)
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://[::ffff:0.0.0.0]/')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false for a trailing-dot localhost (localhost.) without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await check('http://localhost./')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when CSP has a blocking frame-ancestors policy followed by an unrelated comma-joined policy', async () => {
    mockFetchOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Security-Policy': "frame-ancestors 'none', default-src *" },
    }))
    expect(await check('https://example.com')).toBe(false)
  })

  it('returns false when CSP has an unrelated policy followed by a comma-joined blocking frame-ancestors policy', async () => {
    mockFetchOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Security-Policy': "default-src 'self', frame-ancestors 'none'" },
    }))
    expect(await check('https://example.com')).toBe(false)
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
