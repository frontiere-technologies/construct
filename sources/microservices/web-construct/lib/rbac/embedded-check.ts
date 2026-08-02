import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

const FETCH_TIMEOUT_MS = 4000

type ResolvedAddress = { address: string; family: number }
type EmbeddedCheckDependencies = {
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>
  request: (url: URL, method: 'HEAD' | 'GET', address: ResolvedAddress) => Promise<Response>
}

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
  if (a === 0) return true // 0.0.0.0/8 ("this network", RFC 1122)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 0 && octets[2] === 2) return true
  if (a === 192 && b === 88 && octets[2] === 99) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && octets[2] === 100) return true
  if (a === 203 && b === 0 && octets[2] === 113) return true
  if (a >= 224) return true
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

function isBlockedHost(hostname: string): boolean {
  // Strip IPv6 brackets and a single trailing FQDN root-label dot (`localhost.` is
  // resolved identically to `localhost` by DNS but fails a bare string comparison).
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost') return true

  if (isBlockedIPv4(host)) return true

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true // ::1 loopback, :: unspecified
    const mapped = decodeIPv4MappedIPv6(host)
    if (mapped && isBlockedIPv4(mapped)) return true
    const firstGroup = host.split(':')[0]
    if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true // fe80::/10 (link-local)
    if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true // fc00::/7 (unique local)
    if (/^ff[0-9a-f]{2}$/.test(firstGroup)) return true // ff00::/8 (multicast)
    if (host.startsWith('2001:db8:')) return true // documentation prefix
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

async function resolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family) return [{ address: host, family }]
  return lookup(host, { all: true, verbatim: true })
}

export function createPinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    // Node's Happy Eyeballs connection path requests `all: true` and requires
    // the callback's array form. Returning the scalar overload in that case is
    // interpreted as an invalid/undefined IP address on Node 22+.
    if (options.all) callback(null, [pinned])
    else callback(null, pinned.address, pinned.family)
  }
}

function requestPinned(url: URL, method: 'HEAD' | 'GET', pinned: ResolvedAddress): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { host: url.host, 'user-agent': 'Construct-Embeddability-Check/1.0' },
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      lookup: createPinnedLookup(pinned),
    }, response => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach(item => headers.append(name, item))
        else if (value != null) headers.set(name, value)
      }
      response.resume()
      resolve(new Response(null, { status: response.statusCode ?? 500, headers }))
    })
    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error('request timeout')))
    request.on('error', reject)
    request.end()
  })
}

const defaultDependencies: EmbeddedCheckDependencies = { resolveHost, request: requestPinned }

export async function checkEmbeddable(
  url: string,
  dependencies: EmbeddedCheckDependencies = defaultDependencies,
): Promise<boolean> {
  if (!isHttpUrl(url)) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (isBlockedHost(parsed.hostname)) return false

  try {
    const addresses = await dependencies.resolveHost(parsed.hostname.replace(/^\[|\]$/g, ''))
    if (!addresses.length || addresses.some(address => isBlockedHost(address.address))) return false
    const pinned = addresses[0]
    let res = await dependencies.request(parsed, 'HEAD', pinned)
    if (res.status === 405 || res.status === 501) {
      res.body?.cancel()
      res = await dependencies.request(parsed, 'GET', pinned)
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
