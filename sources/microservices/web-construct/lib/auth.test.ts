import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le tre verifiche di appartenenza di `lib/auth.ts` (specifica 2026-10-20, §3.1): `authorize` delle
 * credenziali, `authorize` del provider di prova e la callback `signIn` per OIDC. NextAuth e i
 * provider sono finti: il test chiama direttamente le funzioni che `lib/auth.ts` registra.
 */
const mocks = vi.hoisted(() => ({
  config: undefined as undefined | {
    providers: Array<{ id: string; authorize: (credentials: unknown, request?: unknown) => Promise<unknown> }>
    callbacks: { signIn: (params: unknown) => Promise<boolean> }
  },
  isMembershipDeactivated: vi.fn(),
  verifyCredentialCandidate: vi.fn(),
  resolveRequestTenant: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  warn: vi.fn(),
  // Righe che la finta transazione restituisce, per tabella, e aggiornamenti registrati.
  userRows: [] as unknown[],
  updates: [] as string[],
  tables: { users: undefined as unknown, allowedDomains: undefined as unknown },
}))

vi.mock('next-auth', () => ({
  default: (config: typeof mocks.config) => {
    mocks.config = config
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/keycloak', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/microsoft-entra-id', () => ({ default: (options: unknown) => options }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mocks.warn, error: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/lib/auth-rate-limit', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  AuthRateLimitExceeded: class AuthRateLimitExceeded extends Error {},
}))
vi.mock('@/lib/auth-policy', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth-policy')>()),
  verifyCredentialCandidate: mocks.verifyCredentialCandidate,
}))
vi.mock('@/lib/rbac/auth-roles', () => ({ resolveUserAuthorization: vi.fn() }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenant: mocks.resolveRequestTenant }))
vi.mock('@/lib/tenancy/membership', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/membership')>()),
  isMembershipDeactivated: mocks.isMembershipDeactivated,
}))
vi.mock('@/lib/db/tenant-db', () => {
  // Una catena che si può attendere in qualunque punto; le righe dipendono dalla tabella scelta in `from`.
  function fakeTransaction() {
    let rows: unknown[] = []
    const chain: Record<string, unknown> = {}
    for (const name of ['where', 'limit', 'set', 'values', 'onConflictDoNothing']) chain[name] = () => chain
    chain.from = (table: unknown) => {
      rows = table === mocks.tables.allowedDomains ? [{ domain: 'example.test' }] : mocks.userRows
      return chain
    }
    chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
    return {
      select: () => chain,
      insert: () => chain,
      update: (table: unknown) => {
        mocks.updates.push(table === mocks.tables.users ? 'users' : 'other')
        return chain
      },
    }
  }
  return { withGlobal: async (fn: (tx: unknown) => unknown) => fn(fakeTransaction()) }
})

vi.stubEnv('AUTH_TEST_CREDENTIALS', 'true')
vi.stubEnv('NEXT_PUBLIC_AUTH_TEST_MODE', 'true')

const schema = await import('@/lib/db/schema')
mocks.tables.users = schema.users
mocks.tables.allowedDomains = schema.allowedDomains
await import('./auth')

const TENANT = 1
const USER = { id: 'user-1', email: 'persona@example.test', name: 'Persona', passwordHash: 'hash', idUserStatus: 2 }

function provider(id: string) {
  const found = mocks.config?.providers.find(candidate => candidate.id === id)
  if (!found) throw new Error(`provider ${id} not registered`)
  return found
}

beforeEach(() => {
  mocks.isMembershipDeactivated.mockReset().mockResolvedValue(false)
  mocks.verifyCredentialCandidate.mockReset().mockResolvedValue(true)
  mocks.resolveRequestTenant.mockReset().mockResolvedValue(TENANT)
  mocks.enforceAuthRateLimit.mockReset().mockResolvedValue(undefined)
  mocks.warn.mockReset()
  mocks.userRows = [USER]
  mocks.updates = []
})

describe('credentials authorize', () => {
  const credentials = { email: 'Persona@Example.test', password: 'secret' }

  it('does not read the membership when the password is invalid', async () => {
    mocks.verifyCredentialCandidate.mockResolvedValue(false)

    expect(await provider('credentials').authorize(credentials)).toBeNull()
    expect(mocks.isMembershipDeactivated).not.toHaveBeenCalled()
    expect(mocks.updates).toEqual([])
  })

  it('refuses a deactivated membership, logs the reason and skips the authProvider update', async () => {
    mocks.isMembershipDeactivated.mockResolvedValue(true)

    expect(await provider('credentials').authorize(credentials)).toBeNull()
    expect(mocks.isMembershipDeactivated).toHaveBeenCalledWith(TENANT, USER.id)
    expect(mocks.warn).toHaveBeenCalledWith({ reason: 'membership' }, 'credentials rejected')
    expect(mocks.updates).toEqual([])
  })

  it('reads the membership only after the password was verified', async () => {
    const order: string[] = []
    mocks.verifyCredentialCandidate.mockImplementation(async () => { order.push('password'); return true })
    mocks.isMembershipDeactivated.mockImplementation(async () => { order.push('membership'); return false })

    await provider('credentials').authorize(credentials)

    expect(order).toEqual(['password', 'membership'])
  })

  it('returns the user when the membership is active or absent (not deactivated)', async () => {
    mocks.isMembershipDeactivated.mockResolvedValue(false)

    expect(await provider('credentials').authorize(credentials))
      .toEqual({ id: USER.id, email: USER.email, name: USER.name })
    expect(mocks.updates).toEqual(['users'])
  })
})

describe('test provider authorize', () => {
  const credentials = { email: 'Persona@Example.test' }

  it('is registered under the test environment gate', () => {
    expect(provider('test')).toBeDefined()
  })

  it('refuses a deactivated membership', async () => {
    mocks.isMembershipDeactivated.mockResolvedValue(true)

    expect(await provider('test').authorize(credentials)).toBeNull()
    expect(mocks.isMembershipDeactivated).toHaveBeenCalledWith(TENANT, USER.id)
    expect(mocks.warn).toHaveBeenCalledWith({ reason: 'membership' }, 'test credentials rejected')
  })

  it('does not read the membership for an inactive account', async () => {
    mocks.userRows = [{ ...USER, idUserStatus: 1 }]

    expect(await provider('test').authorize(credentials)).toBeNull()
    expect(mocks.isMembershipDeactivated).not.toHaveBeenCalled()
  })

  it('returns the user when the membership is not deactivated', async () => {
    expect(await provider('test').authorize(credentials))
      .toEqual({ id: USER.id, email: USER.email, name: USER.name })
  })
})

describe('signIn callback for OIDC', () => {
  const params = { account: { provider: 'google' }, profile: { email: 'Persona@Example.test' } }

  it('refuses an existing user whose membership is deactivated', async () => {
    mocks.isMembershipDeactivated.mockResolvedValue(true)

    expect(await mocks.config!.callbacks.signIn(params)).toBe(false)
    expect(mocks.isMembershipDeactivated).toHaveBeenCalledWith(TENANT, USER.id)
  })

  it('lets in an existing user whose membership is not deactivated', async () => {
    expect(await mocks.config!.callbacks.signIn(params)).toBe(true)
    expect(mocks.isMembershipDeactivated).toHaveBeenCalledWith(TENANT, USER.id)
  })

  it('lets in a first-time user without reading any membership', async () => {
    mocks.userRows = []

    expect(await mocks.config!.callbacks.signIn(params)).toBe(true)
    expect(mocks.isMembershipDeactivated).not.toHaveBeenCalled()
  })

  it('refuses an inactive account before reading the membership', async () => {
    mocks.userRows = [{ ...USER, idUserStatus: 1 }]

    expect(await mocks.config!.callbacks.signIn(params)).toBe(false)
    expect(mocks.isMembershipDeactivated).not.toHaveBeenCalled()
  })
})
