import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedInvitation } from '@/lib/auth-invitations'

const { sendEmail, recordInvitationDelivery, tenantBaseUrl } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  recordInvitationDelivery: vi.fn(),
  tenantBaseUrl: vi.fn(),
}))
vi.mock('@/lib/mailer', () => ({ sendEmail }))
vi.mock('@/lib/auth-invitations', () => ({ recordInvitationDelivery }))
vi.mock('@/lib/tenancy/tenant-base-url', () => ({ tenantBaseUrl }))

const { buildSetPasswordLink, sendInvitationEmail } = await import('./invitation-email')
const { tenantIdForTest } = await import('@/lib/tenancy/testing')

// Il tenant da cui parte l'invito: il suo indirizzo principale (o AUTH_URL) è la base del link.
const TENANT = tenantIdForTest(7)

const invitation: PreparedInvitation = {
  tokenId: 'token-1',
  rawToken: 'abc',
  userId: 'user-1',
  email: 'persona@example.test',
  expiresAt: '2026-10-23T00:00:00.000Z',
}

describe('buildSetPasswordLink', () => {
  it('builds the set-password link without a double slash', () => {
    expect(buildSetPasswordLink('https://app.example.it/', 'abc')).toBe('https://app.example.it/set-password?token=abc')
    expect(buildSetPasswordLink('https://app.example.it', 'abc')).toBe('https://app.example.it/set-password?token=abc')
  })
})

describe('sendInvitationEmail', () => {
  beforeEach(() => {
    sendEmail.mockReset()
    recordInvitationDelivery.mockReset()
    tenantBaseUrl.mockReset()
  })

  it('records server_configuration when no base URL is set', async () => {
    tenantBaseUrl.mockRejectedValue(new Error('server_configuration'))

    expect(await sendInvitationEmail(invitation, TENANT)).toEqual({ ok: false, code: 'server_configuration' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: false, code: 'server_configuration' })
  })

  it('records base_url_unavailable, without sending, when the address of the tenant cannot be read', async () => {
    tenantBaseUrl.mockRejectedValue(new Error('connection refused'))

    expect(await sendInvitationEmail(invitation, TENANT)).toEqual({ ok: false, code: 'base_url_unavailable' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: false, code: 'base_url_unavailable' })
  })

  it('sends the email with the set-password link on the address of the tenant and records the delivery', async () => {
    tenantBaseUrl.mockResolvedValue('https://a.example.it:8443/')
    sendEmail.mockResolvedValue(undefined)

    expect(await sendInvitationEmail(invitation, TENANT)).toEqual({ ok: true })
    expect(tenantBaseUrl).toHaveBeenCalledWith(TENANT)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe('persona@example.test')
    expect(message.subject).toBe('Benvenuto in Construct — Imposta la tua password')
    expect(message.html).toContain('https://a.example.it:8443/set-password?token=abc')
    expect(message.text).toContain('https://a.example.it:8443/set-password?token=abc')
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: true })
  })

  it('records email_delivery_failed when the mailer throws', async () => {
    tenantBaseUrl.mockResolvedValue('https://app.example.it')
    sendEmail.mockRejectedValue(new Error('smtp down'))

    expect(await sendInvitationEmail(invitation, TENANT)).toEqual({ ok: false, code: 'email_delivery_failed' })
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: false, code: 'email_delivery_failed' })
  })
})
