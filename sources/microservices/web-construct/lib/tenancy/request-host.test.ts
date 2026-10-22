import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))

const { normalizeHost, readRequestHost } = await import('./request-host')

describe('normalizeHost', () => {
  it('normalizes case, port and trailing dot', () => {
    expect(normalizeHost('A.Localhost:3000')).toBe('a.localhost')
    expect(normalizeHost('a.localhost.')).toBe('a.localhost')
    expect(normalizeHost('[::1]:3000')).toBe('::1')
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost('a b')).toBeNull()
  })

  it('treats missing and malformed values as no host', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost(undefined)).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
    expect(normalizeHost('a.localhost:abc')).toBeNull()
    expect(normalizeHost('a.localhost/evil')).toBeNull()
    expect(normalizeHost('user@a.localhost')).toBeNull()
    expect(normalizeHost('.')).toBeNull()
  })

  it('keeps hosts without a port and trims surrounding spaces', () => {
    expect(normalizeHost('localhost')).toBe('localhost')
    expect(normalizeHost(' B.LOCALHOST ')).toBe('b.localhost')
    expect(normalizeHost('A.LOCALHOST:3000')).toBe(normalizeHost('a.localhost'))
  })
})

describe('readRequestHost', () => {
  beforeEach(() => {
    mocks.headers = new Headers()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the host header in the normalized form', async () => {
    mocks.headers = new Headers({ host: 'A.Localhost:3000' })
    expect(await readRequestHost()).toBe('a.localhost')
  })

  it('returns null without a host header', async () => {
    expect(await readRequestHost()).toBeNull()
  })

  it('reads x-forwarded-host only when trusted', async () => {
    mocks.headers = new Headers({ host: 'a.localhost:3000', 'x-forwarded-host': 'evil.example' })
    vi.stubEnv('TRUST_FORWARDED_HOST', '')
    expect(await readRequestHost()).toBe('a.localhost')
    vi.stubEnv('TRUST_FORWARDED_HOST', 'yes')
    expect(await readRequestHost()).toBe('a.localhost')
    vi.stubEnv('TRUST_FORWARDED_HOST', 'true')
    expect(await readRequestHost()).toBe('evil.example')
  })

  it('takes the last value of a forwarded list, the one the trusted proxy appended', async () => {
    vi.stubEnv('TRUST_FORWARDED_HOST', 'true')
    // Il client ha scritto evil.example; il proxy fidato ha aggiunto l'indirizzo vero in fondo.
    mocks.headers = new Headers({ host: 'internal:8080', 'x-forwarded-host': 'evil.example, B.Localhost:443' })
    expect(await readRequestHost()).toBe('b.localhost')
  })

  it('falls back to host when the forwarded value is invalid', async () => {
    vi.stubEnv('TRUST_FORWARDED_HOST', 'true')
    mocks.headers = new Headers({ host: 'a.localhost:3000', 'x-forwarded-host': 'a b' })
    expect(await readRequestHost()).toBe('a.localhost')
    mocks.headers = new Headers({ host: 'a.localhost:3000', 'x-forwarded-host': 'b.localhost, a b' })
    expect(await readRequestHost()).toBe('a.localhost')
  })
})
