import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const {
  prepareInvitation, sendInvitationEmail, joinDefaultTenant, enforceAuthRateLimit, withGlobal,
} = vi.hoisted(() => ({
  prepareInvitation: vi.fn(),
  sendInvitationEmail: vi.fn(),
  joinDefaultTenant: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  withGlobal: vi.fn(),
}))

vi.mock('@/lib/auth-invitations', () => ({ prepareInvitation }))
vi.mock('@/lib/invitation-email', () => ({ sendInvitationEmail }))
vi.mock('@/lib/tenancy/membership', () => ({ joinDefaultTenant }))
vi.mock('@/lib/db/tenant-db', () => ({ withGlobal }))
vi.mock('@/lib/auth-rate-limit', () => ({
  enforceAuthRateLimit,
  AuthRateLimitExceeded: class AuthRateLimitExceeded extends Error {},
}))
vi.mock('@/lib/rbac/access-declarations', () => ({ allowAnonymous: vi.fn() }))

const { POST } = await import('./route')

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
    joinDefaultTenant.mockImplementation(async () => { calls.push('join'); return 'active' })
    sendInvitationEmail.mockImplementation(async () => { calls.push('send'); return { ok: true } })
  })

  it('joins the default tenant before sending the invitation, and answers ok', async () => {
    const response = await POST(request('Persona@Consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).toHaveBeenCalledWith('persona@consentito.test')
    expect(joinDefaultTenant).toHaveBeenCalledWith('user-1')
    expect(calls).toEqual(['join', 'send'])
  })

  it('does neither when there is no invitation to send', async () => {
    prepareInvitation.mockResolvedValue(null)

    const response = await POST(request('persona@consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(joinDefaultTenant).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('does neither when the domain is not allowed', async () => {
    withGlobal.mockResolvedValue([])

    const response = await POST(request('persona@altrove.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(prepareInvitation).not.toHaveBeenCalled()
    expect(joinDefaultTenant).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('answers ok without sending when joining the default tenant fails', async () => {
    joinDefaultTenant.mockRejectedValue(new Error('db down'))

    const response = await POST(request('persona@consentito.test'))

    expect(await response.json()).toEqual({ ok: true })
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })
})
