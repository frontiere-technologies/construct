import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const {
  prepareInvitation, sendInvitationEmail, joinTenantByRegistration, enforceAuthRateLimit, withGlobal,
  resolveHostTenant, readRequestHost, acceptsSelfRegistration,
} = vi.hoisted(() => ({
  acceptsSelfRegistration: vi.fn(),
  prepareInvitation: vi.fn(),
  sendInvitationEmail: vi.fn(),
  joinTenantByRegistration: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  withGlobal: vi.fn(),
  resolveHostTenant: vi.fn(),
  readRequestHost: vi.fn(),
}))

vi.mock('@/lib/auth-invitations', () => ({ prepareInvitation }))
vi.mock('@/lib/invitation-email', () => ({ sendInvitationEmail }))
vi.mock('@/lib/tenancy/membership', () => ({ joinTenantByRegistration, MEMBERSHIP_ACTIVE: 'active' }))
vi.mock('@/lib/tenancy/host-tenants', () => ({ resolveHostTenant }))
vi.mock('@/lib/tenancy/request-host', () => ({ readRequestHost }))
vi.mock('@/lib/tenancy/tenant-settings', () => ({ acceptsSelfRegistration }))
vi.mock('@/lib/db/tenant-db', () => ({ withGlobal }))
vi.mock('@/lib/auth-rate-limit', () => ({
  enforceAuthRateLimit,
  AuthRateLimitExceeded: class AuthRateLimitExceeded extends Error {},
}))
vi.mock('@/lib/rbac/access-declarations', () => ({ allowAnonymous: vi.fn() }))

const { POST } = await import('./route')

// Il tenant dell'indirizzo a.localhost: quello che sceglie l'appartenenza e il link dell'email.
const TENANT_A = 7

function request(email: string): NextRequest {
  return { json: async () => ({ email }) } as unknown as NextRequest
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    calls.length = 0
    vi.resetAllMocks()
    enforceAuthRateLimit.mockResolvedValue(undefined)
    // Il dominio è consentito: la ricerca nella lista dei domini trova una riga.
    withGlobal.mockResolvedValue([{ id: 1 }])
    prepareInvitation.mockResolvedValue({
      tokenId: 'token-1', rawToken: 'abc', userId: 'user-1', email: 'persona@consentito.test', expiresAt: '',
    })
    readRequestHost.mockResolvedValue('a.localhost')
    resolveHostTenant.mockResolvedValue(TENANT_A)
    acceptsSelfRegistration.mockResolvedValue(true)
    joinTenantByRegistration.mockImplementation(async () => { calls.push('join'); return 'active' })
    sendInvitationEmail.mockImplementation(async () => { calls.push('send'); return { ok: true } })
  })

  it('joins the tenant of the address before sending the invitation, and answers ok', async () => {
    const response = await POST(request('Persona@Consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).toHaveBeenCalledWith('persona@consentito.test')
    expect(joinTenantByRegistration).toHaveBeenCalledWith('user-1', TENANT_A)
    expect(calls).toEqual(['join', 'send'])
  })

  it('builds the email link for the tenant it joined, reading the address once', async () => {
    await POST(request('persona@consentito.test'))

    expect(readRequestHost).toHaveBeenCalledOnce()
    expect(resolveHostTenant).toHaveBeenCalledOnce()
    expect(resolveHostTenant).toHaveBeenCalledWith('a.localhost')
    expect(acceptsSelfRegistration).toHaveBeenCalledWith(TENANT_A)
    expect(sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 'token-1' }), TENANT_A)
  })

  it('creates nothing and sends nothing when the tenant of the address refuses self registration, same answer', async () => {
    acceptsSelfRegistration.mockResolvedValue(false)

    const response = await POST(request('persona@consentito.test'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).not.toHaveBeenCalled()
    expect(joinTenantByRegistration).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('creates nothing when the switch cannot be read, same answer', async () => {
    acceptsSelfRegistration.mockRejectedValue(new Error('db down'))

    const response = await POST(request('persona@consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it.each([null, 'deactivated'])('sends nothing when the join leaves no active membership (%s), same answer', async joined => {
    joinTenantByRegistration.mockImplementation(async () => { calls.push('join'); return joined })

    const response = await POST(request('persona@consentito.test'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(calls).toEqual(['join'])
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('does neither when there is no invitation to send', async () => {
    prepareInvitation.mockResolvedValue(null)

    const response = await POST(request('persona@consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(joinTenantByRegistration).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('does neither when the domain is not allowed', async () => {
    withGlobal.mockResolvedValue([])

    const response = await POST(request('persona@altrove.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).not.toHaveBeenCalled()
    expect(joinTenantByRegistration).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('answers ok without sending when joining the tenant of the address fails', async () => {
    joinTenantByRegistration.mockRejectedValue(new Error('db down'))

    const response = await POST(request('persona@consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })
})
