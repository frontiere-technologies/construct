import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailableTenant } from '@/lib/tenancy/host-tenants'
import { tenantIdForTest } from '@/lib/tenancy/testing'

/**
 * Le callback e gli `authorize` di `lib/auth.ts`: il rifiuto all'accesso per l'appartenenza
 * disattivata sull'indirizzo (specifica 2026-10-21, MT4-DEC-15) e il tenant nel token, scelto
 * all'accesso e rivalidato a ogni richiesta (§3.1, MT4-DEC-4, MT4-DEC-7, MT4-DEC-16, §5.1).
 * NextAuth e i provider sono finti: il test chiama direttamente le funzioni che `lib/auth.ts`
 * registra. Le letture dal database sono finte; la regola di scelta e la lettura dell'indirizzo
 * sono quelle vere.
 */
type Token = Record<string, unknown>
type SessionShape = { user: Record<string, unknown>; expires: string }

const mocks = vi.hoisted(() => ({
  config: undefined as undefined | {
    trustHost?: boolean
    providers: Array<{ id: string; authorize: (credentials: unknown, request?: unknown) => Promise<unknown> }>
    callbacks: {
      signIn: (params: unknown) => Promise<boolean>
      jwt: (params: unknown) => Promise<Record<string, unknown>>
      session: (params: unknown) => Promise<{ user: Record<string, unknown> }>
    }
  },
  // La risposta che i finti handler di NextAuth restituiscono.
  handlerResponse: () => new Response(null) as Response,
  headers: new Headers(),
  verifyCredentialCandidate: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  listAvailableTenants: vi.fn(),
  resolveHostTenant: vi.fn(),
  hasDeactivatedMembershipOnHost: vi.fn(),
  hasInactiveMembershipOnHost: vi.fn(),
  isDedicatedHost: vi.fn(),
  ensureDefaultMembership: vi.fn(),
  resolveUserAuthorization: vi.fn(),
  resolveTenantAuthorization: vi.fn(),
  warn: vi.fn(),
  // Righe che la finta transazione restituisce, per tabella, e scritture registrate.
  userRows: [] as unknown[],
  updates: [] as string[],
  sets: [] as Record<string, unknown>[],
  tenantTransactions: [] as unknown[],
  tables: { users: undefined as unknown, allowedDomains: undefined as unknown },
}))

vi.mock('next-auth', () => ({
  default: (config: typeof mocks.config) => {
    mocks.config = config
    const handler = async () => mocks.handlerResponse()
    return { handlers: { GET: handler, POST: handler }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/keycloak', () => ({ default: (options: unknown) => options }))
vi.mock('next-auth/providers/microsoft-entra-id', () => ({ default: (options: unknown) => options }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
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
vi.mock('@/lib/rbac/auth-roles', () => ({
  resolveUserAuthorization: mocks.resolveUserAuthorization,
  resolveTenantAuthorization: mocks.resolveTenantAuthorization,
}))
vi.mock('@/lib/tenancy/host-tenants', () => ({
  listAvailableTenants: mocks.listAvailableTenants,
  resolveHostTenant: mocks.resolveHostTenant,
  hasDeactivatedMembershipOnHost: mocks.hasDeactivatedMembershipOnHost,
  hasInactiveMembershipOnHost: mocks.hasInactiveMembershipOnHost,
  isDedicatedHost: mocks.isDedicatedHost,
}))
vi.mock('@/lib/tenancy/membership', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/membership')>()),
  ensureDefaultMembership: mocks.ensureDefaultMembership,
}))
vi.mock('@/lib/db/tenant-db', () => {
  // Una catena che si può attendere in qualunque punto; le righe dipendono dalla tabella scelta in `from`.
  function fakeTransaction() {
    let rows: unknown[] = []
    const chain: Record<string, unknown> = {}
    for (const name of ['where', 'limit', 'values', 'onConflictDoNothing']) chain[name] = () => chain
    chain.set = (values: Record<string, unknown>) => {
      mocks.sets.push(values)
      return chain
    }
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
  return {
    withGlobal: async (fn: (tx: unknown) => unknown) => fn(fakeTransaction()),
    withTenant: async (tenantId: unknown, fn: (tx: unknown) => unknown) => {
      mocks.tenantTransactions.push(tenantId)
      return fn(fakeTransaction())
    },
  }
})

vi.stubEnv('AUTH_TEST_CREDENTIALS', 'true')
vi.stubEnv('NEXT_PUBLIC_AUTH_TEST_MODE', 'true')
vi.stubEnv('AUTH_URL', 'http://localhost:3000')
vi.stubEnv('TRUST_FORWARDED_HOST', '')

const schema = await import('@/lib/db/schema')
mocks.tables.users = schema.users
mocks.tables.allowedDomains = schema.allowedDomains
const { handlers } = await import('./auth')

const DEFAULT_TENANT = 1
const OTHER_TENANT = 2
// La finta transazione restituisce le righe così come sono, qualunque colonna scelga la select:
// `status` e `lastTenantId` sono i nomi con cui il token legge stato e ultimo tenant della persona.
const USER = { id: 'user-1', email: 'persona@example.test', name: 'Persona', passwordHash: 'hash', idUserStatus: 2, lastTenantId: null as number | null, status: 2 }
const ROLES = { accountActive: true, roleIds: [0], isAdmin: false }

function tenants(...ids: number[]): AvailableTenant[] {
  return ids.map(id => ({ tenantId: tenantIdForTest(id), name: `Tenant ${id}`, isAdmin: false }))
}

function provider(id: string) {
  const found = mocks.config?.providers.find(candidate => candidate.id === id)
  if (!found) throw new Error(`provider ${id} not registered`)
  return found
}

function onHost(host: string, extra: Record<string, string> = {}) {
  mocks.headers = new Headers({ host, ...extra })
}

/** L'accesso con credenziali: la callback jwt con `account` e `user`, come la chiama Auth.js. */
async function signInToken(token: Token = {}) {
  return mocks.config!.callbacks.jwt({ token, user: { id: USER.id }, account: { provider: 'credentials' }, trigger: 'signIn' })
}

/** Una richiesta successiva con il token già emesso. */
async function nextRequestToken(token: Token, extra: Record<string, unknown> = {}) {
  return mocks.config!.callbacks.jwt({ token, ...extra })
}

async function sessionOf(token: Token) {
  const session: SessionShape = { user: { name: USER.name, email: USER.email }, expires: '2099-01-01T00:00:00.000Z' }
  return mocks.config!.callbacks.session({ session, token })
}

const readyToken = (tenantId: number, host = 'localhost'): Token => ({
  userId: USER.id, provider: 'credentials', accountActive: true, roleIds: [0],
  tenantId, tenantState: 'ready', tenantHost: host, tenantName: `Tenant ${tenantId}`,
})

beforeEach(() => {
  onHost('localhost:3000')
  mocks.verifyCredentialCandidate.mockReset().mockResolvedValue(true)
  mocks.enforceAuthRateLimit.mockReset().mockResolvedValue(undefined)
  mocks.listAvailableTenants.mockReset().mockResolvedValue(tenants(DEFAULT_TENANT))
  mocks.resolveHostTenant.mockReset().mockResolvedValue(DEFAULT_TENANT)
  mocks.hasDeactivatedMembershipOnHost.mockReset().mockResolvedValue(false)
  mocks.hasInactiveMembershipOnHost.mockReset().mockResolvedValue(false)
  mocks.isDedicatedHost.mockReset().mockResolvedValue(false)
  mocks.ensureDefaultMembership.mockReset().mockResolvedValue('active')
  mocks.resolveUserAuthorization.mockReset().mockResolvedValue(ROLES)
  mocks.resolveTenantAuthorization.mockReset()
    .mockResolvedValue({ ...ROLES, tenantEligible: true, tenantName: `Tenant ${DEFAULT_TENANT}` })
  mocks.warn.mockReset()
  mocks.userRows = [USER]
  mocks.updates = []
  mocks.sets = []
  mocks.tenantTransactions = []
})

describe('credentials authorize', () => {
  const credentials = { email: 'Persona@Example.test', password: 'secret' }

  it('does not read the memberships when the password is invalid', async () => {
    mocks.verifyCredentialCandidate.mockResolvedValue(false)

    expect(await provider('credentials').authorize(credentials)).toBeNull()
    expect(mocks.hasDeactivatedMembershipOnHost).not.toHaveBeenCalled()
    expect(mocks.listAvailableTenants).not.toHaveBeenCalled()
    expect(mocks.updates).toEqual([])
  })

  it('refuses a deactivated membership on the address with no tenant left, logs the reason and skips the authProvider update', async () => {
    mocks.hasDeactivatedMembershipOnHost.mockResolvedValue(true)
    mocks.listAvailableTenants.mockResolvedValue([])

    expect(await provider('credentials').authorize(credentials)).toBeNull()
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(mocks.warn).toHaveBeenCalledWith({ reason: 'membership' }, 'credentials rejected')
    expect(mocks.updates).toEqual([])
  })

  it('lets in a deactivated membership on the address when another tenant there is available (MT4-DEC-15)', async () => {
    mocks.hasDeactivatedMembershipOnHost.mockResolvedValue(true)
    mocks.listAvailableTenants.mockResolvedValue(tenants(OTHER_TENANT))

    expect(await provider('credentials').authorize(credentials))
      .toEqual({ id: USER.id, email: USER.email, name: USER.name })
  })

  it('reads the memberships only after the password was verified', async () => {
    const order: string[] = []
    mocks.verifyCredentialCandidate.mockImplementation(async () => { order.push('password'); return true })
    mocks.hasDeactivatedMembershipOnHost.mockImplementation(async () => { order.push('membership'); return false })

    await provider('credentials').authorize(credentials)

    expect(order).toEqual(['password', 'membership'])
  })

  it('returns the user when no membership on the address is deactivated', async () => {
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

  it('refuses a deactivated membership on the address with no tenant left', async () => {
    mocks.hasDeactivatedMembershipOnHost.mockResolvedValue(true)
    mocks.listAvailableTenants.mockResolvedValue([])

    expect(await provider('test').authorize(credentials)).toBeNull()
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(mocks.warn).toHaveBeenCalledWith({ reason: 'membership' }, 'test credentials rejected')
  })

  it('does not read the memberships for an inactive account', async () => {
    mocks.userRows = [{ ...USER, idUserStatus: 1 }]

    expect(await provider('test').authorize(credentials)).toBeNull()
    expect(mocks.hasDeactivatedMembershipOnHost).not.toHaveBeenCalled()
  })

  it('returns the user when no membership on the address is deactivated', async () => {
    expect(await provider('test').authorize(credentials))
      .toEqual({ id: USER.id, email: USER.email, name: USER.name })
  })
})

describe('signIn callback for OIDC', () => {
  const params = { account: { provider: 'google' }, profile: { email: 'Persona@Example.test' } }

  it('refuses an existing user with a deactivated membership on the address and no tenant left', async () => {
    mocks.hasDeactivatedMembershipOnHost.mockResolvedValue(true)
    mocks.listAvailableTenants.mockResolvedValue([])

    expect(await mocks.config!.callbacks.signIn(params)).toBe(false)
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')
  })

  it('lets in an existing user without a deactivated membership on the address', async () => {
    expect(await mocks.config!.callbacks.signIn(params)).toBe(true)
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')
  })

  it('lets in a first-time user without reading any membership', async () => {
    mocks.userRows = []

    expect(await mocks.config!.callbacks.signIn(params)).toBe(true)
    expect(mocks.hasDeactivatedMembershipOnHost).not.toHaveBeenCalled()
  })

  // MT4-DEC-14: su un indirizzo dedicato si entra con email e password; Google resta sull'indirizzo
  // principale. La pagina di accesso nasconde il bottone (app/login/page.test.tsx), il callback rifiuta.
  describe('on a dedicated host the login page hides "Continua con Google" and signIn refuses OIDC', () => {
    it.each(['google', 'microsoft-entra-id', 'keycloak'])('signIn refuses %s on a dedicated host, before any other read', async oidc => {
      onHost('A.Localhost:3000')
      mocks.isDedicatedHost.mockResolvedValue(true)

      expect(await mocks.config!.callbacks.signIn({ ...params, account: { provider: oidc } })).toBe(false)
      expect(mocks.isDedicatedHost).toHaveBeenCalledWith('a.localhost')
      expect(mocks.hasDeactivatedMembershipOnHost).not.toHaveBeenCalled()
    })

    it('signIn still lets in OIDC on the main address', async () => {
      expect(await mocks.config!.callbacks.signIn(params)).toBe(true)
      expect(mocks.isDedicatedHost).toHaveBeenCalledWith('localhost')
    })

    it('signIn does not look at the host for credentials', async () => {
      onHost('a.localhost:3000')
      mocks.isDedicatedHost.mockResolvedValue(true)

      expect(await mocks.config!.callbacks.signIn({ account: { provider: 'credentials' }, user: { id: USER.id } })).toBe(true)
      expect(mocks.isDedicatedHost).not.toHaveBeenCalled()
    })
  })

  it('refuses an inactive account before reading the memberships', async () => {
    mocks.userRows = [{ ...USER, idUserStatus: 1 }]

    expect(await mocks.config!.callbacks.signIn(params)).toBe(false)
    expect(mocks.hasDeactivatedMembershipOnHost).not.toHaveBeenCalled()
  })
})

describe('tenant chosen at sign-in (MT4-DEC-4, MT4-DEC-15, MT4-DEC-16)', () => {
  it('sign-in on an address with one tenant gives state ready', async () => {
    onHost('A.Localhost:3000')
    mocks.resolveHostTenant.mockResolvedValue(OTHER_TENANT)
    mocks.listAvailableTenants.mockResolvedValue(tenants(OTHER_TENANT))

    const token = await signInToken()

    expect(token).toMatchObject({
      userId: USER.id, tenantId: OTHER_TENANT, tenantState: 'ready', tenantHost: 'a.localhost',
      tenantName: `Tenant ${OTHER_TENANT}`, accountActive: true, roleIds: [0],
    })
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'a.localhost')
    // Il ruolo base si assicura nel tenant in cui si entra, come all'accesso di oggi.
    expect(mocks.resolveUserAuthorization).toHaveBeenCalledWith(OTHER_TENANT, USER.id, true)
    const session = await sessionOf(token)
    expect(session.user).toMatchObject({ id: USER.id, tenantState: 'ready', tenantId: OTHER_TENANT, tenantName: `Tenant ${OTHER_TENANT}`, roleIds: [0] })
  })

  it('sign-in with no tenant available and a suspended one on the address gives none with the suspended reason, and the session carries it (MT5-DEC-7)', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.hasInactiveMembershipOnHost.mockResolvedValue(true)

    const token = await signInToken()

    expect(token).toMatchObject({ tenantState: 'none', tenantId: null, tenantNoneReason: 'suspended' })
    expect(mocks.hasInactiveMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')
    expect((await sessionOf(token)).user).toMatchObject({ tenantState: 'none', tenantNoneReason: 'suspended' })
  })

  it('a session in none without the reason, or in another state, carries no reason; the generic message stays', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    const token = await signInToken()
    expect(token).toMatchObject({ tenantState: 'none', tenantNoneReason: null })
    expect((await sessionOf(token)).user).toMatchObject({ tenantNoneReason: null })
    // Un motivo rimasto in un token che non è più `none` non esce.
    expect((await sessionOf({ ...token, tenantState: 'choose', tenantNoneReason: 'suspended' })).user).toMatchObject({ tenantNoneReason: null })
  })

  it('does not look for a suspended tenant when the person has one to work in or to choose from', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))
    await signInToken()
    expect(mocks.hasInactiveMembershipOnHost).not.toHaveBeenCalled()
  })

  it('sign-in with several tenants and no last tenant gives state choose', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))

    const token = await signInToken()

    expect(token).toMatchObject({ tenantId: null, tenantState: 'choose', tenantHost: 'localhost', tenantName: null, accountActive: true, roleIds: [] })
    expect(mocks.resolveUserAuthorization).not.toHaveBeenCalled()
    // Account attivo, nessun tenant: la sessione resta della persona ma senza ruoli né tenant.
    const session = await sessionOf(token)
    expect(session.user).toMatchObject({ id: USER.id, accountActive: true, roleIds: [], tenantState: 'choose', tenantId: null, tenantName: null })
  })

  it('sign-in with several tenants enters the last used one', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))
    mocks.userRows = [{ ...USER, lastTenantId: OTHER_TENANT }]

    expect(await signInToken()).toMatchObject({ tenantId: OTHER_TENANT, tenantState: 'ready', tenantName: `Tenant ${OTHER_TENANT}` })
  })

  it('entering directly (single tenant or last used) never writes last_tenant_id', async () => {
    mocks.userRows = [{ ...USER, lastTenantId: OTHER_TENANT }]
    expect(await signInToken()).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready' })

    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))
    expect(await signInToken()).toMatchObject({ tenantId: OTHER_TENANT, tenantState: 'ready' })

    expect(mocks.updates).toEqual([])
    expect(mocks.sets.filter(values => 'lastTenantId' in values)).toEqual([])
  })

  it('sign-in with no tenant on the address and a deactivated membership there is refused as today', async () => {
    onHost('a.localhost:3000')
    mocks.hasDeactivatedMembershipOnHost.mockResolvedValue(true)
    mocks.listAvailableTenants.mockResolvedValue([])

    expect(await provider('credentials').authorize({ email: USER.email, password: 'secret' })).toBeNull()
    expect(await provider('test').authorize({ email: USER.email })).toBeNull()
    expect(await mocks.config!.callbacks.signIn({ account: { provider: 'google' }, profile: { email: USER.email } })).toBe(false)
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'a.localhost')
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'a.localhost')
  })

  it('sign-in with no membership on the address gives state none', async () => {
    onHost('a.localhost:3000')
    mocks.listAvailableTenants.mockResolvedValue([])

    expect(await provider('credentials').authorize({ email: USER.email, password: 'secret' })).not.toBeNull()
    const token = await signInToken()

    expect(token).toMatchObject({ tenantId: null, tenantState: 'none', tenantHost: 'a.localhost', accountActive: true, roleIds: [] })
    const session = await sessionOf(token)
    expect(session.user).toMatchObject({ id: USER.id, accountActive: true, tenantState: 'none', tenantId: null, roleIds: [] })
  })

  it('exposes the platform admin attribute of the token in the session, only for an active account', async () => {
    const none: Token = { userId: USER.id, provider: 'credentials', accountActive: true, roleIds: [], tenantId: null, tenantState: 'none', tenantHost: 'a.localhost', tenantName: null }
    expect((await sessionOf({ ...none, isPlatformAdmin: true })).user).toMatchObject({ tenantState: 'none', isPlatformAdmin: true })
    expect((await sessionOf(none)).user).toMatchObject({ isPlatformAdmin: false })
    expect((await sessionOf({ ...none, accountActive: false, isPlatformAdmin: true })).user).toMatchObject({ isPlatformAdmin: false })
  })

  // Pezzo 5a, Task 9 (§3.2): in assistenza la sessione porta il tenant assistito come `ready`, più scadenza e motivo per la fascia.
  it('a support token gives a session in the supported tenant with the expiry and the reason, and nothing of them elsewhere', async () => {
    const support: Token = {
      userId: USER.id, provider: 'credentials', accountActive: true, roleIds: [1], tenantId: 7, tenantState: 'support',
      tenantHost: 'localhost', tenantName: 'Acme', isPlatformAdmin: true, supportUntil: '2026-10-27T12:00:00.000Z', supportReason: 'controllo',
    }
    expect((await sessionOf(support)).user).toMatchObject({
      id: USER.id, tenantState: 'support', tenantId: 7, tenantName: 'Acme', roleIds: [1],
      supportUntil: '2026-10-27T12:00:00.000Z', supportReason: 'controllo',
    })
    // Fuori dall'assistenza i campi non passano, anche se il token li portasse ancora.
    expect((await sessionOf({ ...support, tenantState: 'ready' })).user).toMatchObject({ supportUntil: null, supportReason: null })
    // Un'assistenza appena finita non è il messaggio dello spazio sospeso.
    expect((await sessionOf({ ...support, tenantState: 'none', tenantNoneReason: 'support_ended' })).user)
      .toMatchObject({ tenantId: null, roleIds: [], tenantNoneReason: null })
  })

  it('gives the first default membership before listing the tenants of the address (MT2-DEC-12)', async () => {
    const order: string[] = []
    mocks.ensureDefaultMembership.mockImplementation(async () => { order.push('ensure'); return 'active' })
    mocks.listAvailableTenants.mockImplementation(async () => { order.push('list'); return tenants(DEFAULT_TENANT) })

    await signInToken()

    expect(order).toEqual(['ensure', 'list'])
    expect(mocks.tenantTransactions[0]).toBe(DEFAULT_TENANT)
  })

  it('a globally deactivated account in state choose or none is not active', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.userRows = [{ ...USER, idUserStatus: 1, status: 1 }]

    const token = await signInToken()

    expect(token).toMatchObject({ tenantState: 'none', accountActive: false })
    expect((await sessionOf(token)).user).toMatchObject({ id: '', accountActive: false })
  })
})

describe('tenant revalidated on every request (MT4-DEC-7, §5.1)', () => {
  it('keeps a valid ready token with the single authorization read and no tenant listing', async () => {
    const token = await nextRequestToken(readyToken(DEFAULT_TENANT))

    expect(token).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready', tenantHost: 'localhost', accountActive: true, roleIds: [0] })
    expect(mocks.resolveTenantAuthorization).toHaveBeenCalledWith(DEFAULT_TENANT, USER.id, 'localhost')
    expect(mocks.listAvailableTenants).not.toHaveBeenCalled()
    expect(mocks.resolveUserAuthorization).not.toHaveBeenCalled()
  })

  it('recomputes when the tenant is no longer eligible or the membership is no longer active', async () => {
    mocks.resolveTenantAuthorization.mockResolvedValue({ accountActive: false, roleIds: [], isAdmin: false, tenantEligible: true, tenantName: 'Tenant 2' })
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, 3))

    expect(await nextRequestToken(readyToken(OTHER_TENANT))).toMatchObject({ tenantId: null, tenantState: 'choose', roleIds: [] })

    mocks.resolveTenantAuthorization.mockResolvedValue({ ...ROLES, tenantEligible: false, tenantName: 'Tenant 2' })
    mocks.listAvailableTenants.mockResolvedValue([])
    expect(await nextRequestToken(readyToken(OTHER_TENANT))).toMatchObject({ tenantId: null, tenantState: 'none', roleIds: [] })
  })

  it('recomputes a token chosen on another address', async () => {
    onHost('a.localhost:3000')
    mocks.listAvailableTenants.mockResolvedValue(tenants(3))

    const token = await nextRequestToken(readyToken(OTHER_TENANT, 'b.localhost'))

    expect(mocks.resolveTenantAuthorization).not.toHaveBeenCalled()
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'a.localhost')
    expect(token).toMatchObject({ tenantId: 3, tenantState: 'ready', tenantHost: 'a.localhost' })
  })

  it('a token waiting for a choice reads only the account, not the tenants of the address', async () => {
    const token = await nextRequestToken({ userId: USER.id, accountActive: true, roleIds: [], tenantId: null, tenantState: 'choose', tenantHost: 'localhost', tenantName: null })

    expect(token).toMatchObject({ tenantState: 'choose', accountActive: true, roleIds: [] })
    expect(mocks.listAvailableTenants).not.toHaveBeenCalled()
    expect(mocks.resolveTenantAuthorization).not.toHaveBeenCalled()
  })

  it('a token without tenant fields (session from before the release) is treated as a new sign-in', async () => {
    const token = await nextRequestToken({ userId: USER.id, provider: 'credentials', accountActive: true, roleIds: [0] })

    expect(mocks.ensureDefaultMembership).toHaveBeenCalled()
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(mocks.resolveUserAuthorization).toHaveBeenCalledWith(DEFAULT_TENANT, USER.id, true)
    expect(mocks.resolveTenantAuthorization).not.toHaveBeenCalled()
    expect(token).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready', tenantHost: 'localhost', accountActive: true })
  })

  it('no request parameter, form field or header other than the host changes the tenant', async () => {
    // Intestazioni che un client può scrivere: nessuna conta, tranne Host. x-forwarded-host vale
    // solo dietro un proxy fidato (TRUST_FORWARDED_HOST), qui spento.
    onHost('localhost:3000', { 'x-forwarded-host': 'b.localhost', 'x-tenant-id': '2', cookie: 'tenant=2' })

    // Un campo in più nel modulo di accesso non arriva da nessuna parte.
    const user = await provider('credentials').authorize({ email: USER.email, password: 'secret', tenantId: '2', tenant: 'b' })
    expect(user).toEqual({ id: USER.id, email: USER.email, name: USER.name })
    expect(mocks.hasDeactivatedMembershipOnHost).toHaveBeenCalledWith(USER.id, 'localhost')

    const token = await signInToken()
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(token).toMatchObject({ tenantId: DEFAULT_TENANT, tenantHost: 'localhost' })

    // Un aggiornamento della sessione dal client (POST /api/auth/session) porta dati suoi: ignorati.
    const updated = await nextRequestToken(readyToken(DEFAULT_TENANT), {
      trigger: 'update',
      session: { tenantId: OTHER_TENANT, tenantState: 'ready', user: { tenantId: OTHER_TENANT } },
    })
    expect(mocks.resolveTenantAuthorization).toHaveBeenCalledWith(DEFAULT_TENANT, USER.id, 'localhost')
    expect(updated).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready' })
    expect(mocks.resolveTenantAuthorization).not.toHaveBeenCalledWith(OTHER_TENANT, expect.anything(), expect.anything())
  })
})

describe('several hosts (MT4-RISK-1)', () => {
  it('trusts the request host', () => {
    expect(mocks.config?.trustHost).toBe(true)
  })

  it('keeps the sign-in return on the request host instead of AUTH_URL', async () => {
    mocks.handlerResponse = () => Response.json({ url: 'http://localhost:3000/' })
    const request = new NextRequest('http://a.localhost:3000/api/auth/callback/test', {
      method: 'POST',
      headers: { 'X-Auth-Return-Redirect': '1' },
    })

    expect(await (await handlers.POST(request)).json()).toEqual({ url: '/' })
  })

  it('keeps the redirects of the GET handler on the request host', async () => {
    mocks.handlerResponse = () => Response.redirect('http://localhost:3000/login?error=Configuration', 302)
    const response = await handlers.GET(new NextRequest('http://a.localhost:3000/api/auth/error'))

    expect(response.headers.get('location')).toBe('/login?error=Configuration')
  })
})

/**
 * L'aggiornamento della sessione (trigger 'update'): lo chiama `chooseTenant` con `unstable_update`,
 * ma ci arriva anche un POST /api/auth/session scritto dal client. Il carico non è mai fidato: un
 * `tenantId` vale solo se è fra i tenant disponibili sull'indirizzo della richiesta, e nessun altro
 * campo entra (regola del controllore sul Task 4, MT4-DEC-7, MT4-DEC-16).
 */
describe('session update (trigger update, MT4-DEC-5, MT4-DEC-7)', () => {
  const chooseToken = (tenantState: 'choose' | 'none' = 'choose'): Token => ({
    userId: USER.id, provider: 'credentials', accountActive: true, roleIds: [],
    tenantId: null, tenantState, tenantHost: 'localhost', tenantName: null,
  })

  async function updateToken(token: Token, session: unknown) {
    return nextRequestToken(token, { trigger: 'update', session })
  }

  it('a forged update with a tenant not available on the address changes nothing', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT))

    const updated = await updateToken(readyToken(DEFAULT_TENANT), { user: { tenantId: OTHER_TENANT } })

    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(updated).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready', tenantHost: 'localhost' })
    expect(mocks.resolveUserAuthorization).not.toHaveBeenCalledWith(OTHER_TENANT, expect.anything(), expect.anything())
    expect(mocks.resolveTenantAuthorization).not.toHaveBeenCalledWith(OTHER_TENANT, expect.anything(), expect.anything())

    // Anche da una sessione in attesa di scelta: il tenant non disponibile non si entra.
    const waiting = await updateToken(chooseToken(), { user: { tenantId: OTHER_TENANT } })
    expect(waiting).toMatchObject({ tenantId: null, tenantState: 'choose' })
  })

  it('an update with a tenant available on the address enters it, without writing last_tenant_id', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))
    mocks.resolveUserAuthorization.mockResolvedValue({ accountActive: true, roleIds: [1], isAdmin: true })

    const fromChoice = await updateToken(chooseToken(), { user: { tenantId: OTHER_TENANT } })
    expect(fromChoice).toMatchObject({
      tenantId: OTHER_TENANT, tenantState: 'ready', tenantHost: 'localhost',
      tenantName: `Tenant ${OTHER_TENANT}`, accountActive: true, roleIds: [1],
    })
    expect(mocks.resolveUserAuthorization).toHaveBeenCalledWith(OTHER_TENANT, USER.id, false)

    const switched = await updateToken(readyToken(DEFAULT_TENANT), { user: { tenantId: OTHER_TENANT } })
    expect(switched).toMatchObject({ tenantId: OTHER_TENANT, tenantState: 'ready' })

    // L'ultimo tenant usato lo scrive solo chooseTenant, dopo il suo controllo (MT4-DEC-16).
    expect(mocks.updates).toEqual([])
    expect(mocks.sets.filter(values => 'lastTenantId' in values)).toEqual([])
  })

  it('takes nothing but a numeric tenantId from the payload', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))

    for (const payload of [
      { user: { tenantId: String(OTHER_TENANT) } },
      { user: { tenantId: OTHER_TENANT + 0.5 } },
      { user: { tenantId: -OTHER_TENANT } },
      // Il tenantId vale solo nella forma di unstable_update, dentro `user`.
      { tenantId: OTHER_TENANT },
      { tenantState: 'ready', tenantHost: 'b.localhost', accountActive: true, roleIds: [1], tenantName: 'Forged' },
      null,
      'tenant',
    ]) {
      const updated = await updateToken(readyToken(DEFAULT_TENANT), payload)
      expect(updated).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready', tenantHost: 'localhost', tenantName: `Tenant ${DEFAULT_TENANT}`, roleIds: [0] })
    }
    expect(mocks.resolveUserAuthorization).not.toHaveBeenCalled()
  })

  it('an update without a tenant recomputes a session in state choose or none (refresh)', async () => {
    // Aggiunta a un tenant dopo l'arrivo sul messaggio: l'aggiornamento la fa entrare.
    mocks.listAvailableTenants.mockResolvedValue(tenants(OTHER_TENANT))

    const refreshed = await updateToken(chooseToken('none'), {})
    expect(mocks.listAvailableTenants).toHaveBeenCalledWith(USER.id, 'localhost')
    expect(refreshed).toMatchObject({ tenantId: OTHER_TENANT, tenantState: 'ready', tenantHost: 'localhost' })

    mocks.listAvailableTenants.mockResolvedValue([])
    expect(await updateToken(chooseToken('choose'), undefined)).toMatchObject({ tenantId: null, tenantState: 'none' })
    // Nessuna scrittura: né l'ultimo tenant usato né l'appartenenza al predefinito.
    expect(mocks.ensureDefaultMembership).not.toHaveBeenCalled()
    expect(mocks.sets.filter(values => 'lastTenantId' in values)).toEqual([])
  })

  it('an update without a tenant on a ready session is the usual revalidation', async () => {
    const updated = await updateToken(readyToken(DEFAULT_TENANT), {})

    expect(updated).toMatchObject({ tenantId: DEFAULT_TENANT, tenantState: 'ready' })
    expect(mocks.resolveTenantAuthorization).toHaveBeenCalledWith(DEFAULT_TENANT, USER.id, 'localhost')
    expect(mocks.listAvailableTenants).not.toHaveBeenCalled()
  })

  it('a request that is not an update ignores a session payload', async () => {
    mocks.listAvailableTenants.mockResolvedValue(tenants(DEFAULT_TENANT, OTHER_TENANT))

    const token = await nextRequestToken(readyToken(DEFAULT_TENANT), { session: { tenantId: OTHER_TENANT } })

    expect(token).toMatchObject({ tenantId: DEFAULT_TENANT })
    expect(mocks.listAvailableTenants).not.toHaveBeenCalled()
  })
})
