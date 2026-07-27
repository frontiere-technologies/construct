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

// Blocks only literal private/loopback/link-local addresses (SSRF hardening for this
// admin-only, server-side fetch). This does NOT resolve DNS, so a public hostname that
// resolves to a private IP at request time (DNS rebinding) is a known, accepted residual
// risk for this pass — out of scope by design.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '0.0.0.0') return true

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
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

  if (host.includes(':')) {
    if (host === '::1') return true
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
    const directive = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.toLowerCase().startsWith('frame-ancestors'))
    if (directive) {
      const sources = directive.split(/\s+/).slice(1)
      const allowsThisApp = sources.some(admitsThisApp)
      if (!allowsThisApp) return true
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
