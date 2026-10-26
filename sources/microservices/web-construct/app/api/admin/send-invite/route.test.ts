import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  requirePermission, tenantMemberEmail, withGlobal, prepareInvitation, sendInvitationEmail,
} = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  tenantMemberEmail: vi.fn(),
  withGlobal: vi.fn(),
  prepareInvitation: vi.fn(),
  sendInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/rbac/auth-guard', () => ({ requirePermission }))
vi.mock('@/lib/tenancy/membership', () => ({ tenantMemberEmail }))
// La ricerca globale per id non deve più servire: se la rotta la usasse, troverebbe chiunque.
vi.mock('@/lib/db/tenant-db', () => ({ withGlobal }))
vi.mock('@/lib/auth-invitations', () => ({ prepareInvitation }))
vi.mock('@/lib/invitation-email', () => ({ sendInvitationEmail }))

const { POST } = await import('./route')

const TENANT_A = 7
const actor = { userId: 'admin-a', tenantId: TENANT_A, roleIds: [], isAdmin: true, permissions: new Set(['invite-users']) }

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

describe('POST /api/admin/send-invite', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requirePermission.mockResolvedValue(actor)
    // Chiunque esista nel database: la persona di un altro tenant compresa.
    withGlobal.mockResolvedValue([{ email: 'persona@altro-tenant.test' }])
    prepareInvitation.mockResolvedValue({
      tokenId: 'token-1', rawToken: 'abc', userId: 'user-1', email: 'persona@esempio.test', expiresAt: '',
    })
    sendInvitationEmail.mockResolvedValue({ ok: true })
  })

  it('answers 404 for a person who is not a member of the actor tenant, and prepares nothing', async () => {
    tenantMemberEmail.mockResolvedValue(null)

    const response = await POST(request({ userId: 'user-of-b' }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Utente non trovato.' })
    expect(tenantMemberEmail).toHaveBeenCalledWith(TENANT_A, 'user-of-b')
    expect(prepareInvitation).not.toHaveBeenCalled()
    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('invites a member of the actor tenant as before', async () => {
    tenantMemberEmail.mockResolvedValue('persona@esempio.test')

    const response = await POST(request({ userId: 'user-1' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(tenantMemberEmail).toHaveBeenCalledWith(TENANT_A, 'user-1')
    expect(prepareInvitation).toHaveBeenCalledWith('persona@esempio.test', 'admin-a')
    expect(sendInvitationEmail).toHaveBeenCalledOnce()
    // Il link parte dall'indirizzo del tenant di chi invita (MT4-DEC-12).
    expect(sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 'token-1' }), TENANT_A)
  })

  it('answers 403 without an actor allowed to invite', async () => {
    requirePermission.mockRejectedValue(new Error('Unauthorized'))

    const response = await POST(request({ userId: 'user-1' }))

    expect(response.status).toBe(403)
    expect(tenantMemberEmail).not.toHaveBeenCalled()
  })

  it('answers 400 without a userId', async () => {
    const response = await POST(request({}))

    expect(response.status).toBe(400)
    expect(tenantMemberEmail).not.toHaveBeenCalled()
  })
})
