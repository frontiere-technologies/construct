const FETCH_TIMEOUT_MS = 4000

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function appOrigin(): string | null {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!base) return null
  try {
    return new URL(base).origin
  } catch {
    return null
  }
}

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/$/, '')
}

function admitsThisApp(source: string): boolean {
  if (source === '*') return true
  const selfOrigin = appOrigin()
  if (!selfOrigin) return false
  try {
    return stripTrailingSlash(new URL(source).origin) === stripTrailingSlash(selfOrigin)
  } catch {
    return false
  }
}

// IPv4 blocklist check, shared by both literal IPv4 hostnames and IPv4-mapped IPv6
// addresses (e.g. `::ffff:127.0.0.1`) once decoded back to dotted-decimal form.
function isBlockedIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  const octets = ipv4.slice(1, 5).map(Number)
  if (octets.some(o => o > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

// The WHATWG URL parser canonicalizes IPv4-mapped IPv6 literals (e.g. `[::ffff:127.0.0.1]`)
// into the hex-group form `::ffff:HHHH:HHHH` (verified via `new URL(...).hostname`, e.g.
// `::ffff:127.0.0.1` -> `::ffff:7f00:1`, `::ffff:169.254.169.254` -> `::ffff:a9fe:a9fe`).
// Decode that canonical form back into a dotted-decimal IPv4 address so the existing IPv4
// blocklist can be re-run against it.
function decodeIPv4MappedIPv6(host: string): string | null {
  const match = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!match) return null
  const hi = match[1].padStart(4, '0')
  const lo = match[2].padStart(4, '0')
  const bytes = [
    parseInt(hi.slice(0, 2), 16),
    parseInt(hi.slice(2, 4), 16),
    parseInt(lo.slice(0, 2), 16),
    parseInt(lo.slice(2, 4), 16),
  ]
  return bytes.join('.')
}

// Blocks only literal private/loopback/link-local addresses (SSRF hardening for this
// admin-only, server-side fetch). This does NOT resolve DNS, so a public hostname that
// resolves to a private IP at request time (DNS rebinding) is a known, accepted residual
// risk for this pass — out of scope by design.
function isBlockedHost(hostname: string): boolean {
  // Strip IPv6 brackets and a single trailing FQDN root-label dot (`localhost.` is
  // resolved identically to `localhost` by DNS but fails a bare string comparison).
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host === '0.0.0.0') return true

  if (isBlockedIPv4(host)) return true

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true // ::1 loopback, :: unspecified
    const mapped = decodeIPv4MappedIPv6(host)
    if (mapped && isBlockedIPv4(mapped)) return true
    const firstGroup = host.split(':')[0]
    if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true // fe80::/10 (link-local)
    if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true // fc00::/7 (unique local)
  }

  return false
}

function blocksEmbedding(headers: Headers): boolean {
  const xfoRaw = headers.get('x-frame-options')
  if (xfoRaw) {
    const tokens = xfoRaw.split(',').map(t => t.trim().toUpperCase())
    if (tokens.some(t => t === 'DENY' || t === 'SAMEORIGIN')) return true
  }

  const csp = headers.get('content-security-policy')
  if (csp) {
    // `Headers.get()` joins repeated `Content-Security-Policy` headers with ", ", and a
    // single response can also legitimately send multiple comma-separated policies in one
    // header line. Each comma-separated chunk is a complete, independently-enforced policy
    // per the CSP spec, so split on ',' first and check every policy's own frame-ancestors
    // directive — blocking if ANY policy restricts embedding (safe-by-default), mirroring
    // how the X-Frame-Options fix treats "any token blocks" as the rule.
    const policies = csp.split(',').map(p => p.trim())
    for (const policy of policies) {
      const directive = policy
        .split(';')
        .map(d => d.trim())
        .find(d => d.toLowerCase().startsWith('frame-ancestors'))
      if (directive) {
        const sources = directive.split(/\s+/).slice(1)
        const allowsThisApp = sources.some(admitsThisApp)
        if (!allowsThisApp) return true
      }
    }
  }
  return false
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkEmbeddable(url: string): Promise<boolean> {
  if (!isHttpUrl(url)) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (isBlockedHost(parsed.hostname)) return false

  try {
    let res = await fetchWithTimeout(url, 'HEAD')
    if (res.status === 405 || res.status === 501) {
      res.body?.cancel()
      res = await fetchWithTimeout(url, 'GET')
    }

    // redirect: 'manual' surfaces redirects as an opaque response (type 'opaqueredirect',
    // typically status 0) or, for mocked/test Response objects, a plain 3xx status. Treat
    // either as "not embeddable" rather than silently following a redirect to another host.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      res.body?.cancel()
      return false
    }

    const blocked = blocksEmbedding(res.headers)
    res.body?.cancel()
    return !blocked
  } catch {
    return false
  }
}
