import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedInvitation } from '@/lib/auth-invitations'

const { sendEmail, recordInvitationDelivery } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  recordInvitationDelivery: vi.fn(),
}))
vi.mock('@/lib/mailer', () => ({ sendEmail }))
vi.mock('@/lib/auth-invitations', () => ({ recordInvitationDelivery }))

const { buildSetPasswordLink, sendInvitationEmail } = await import('./invitation-email')

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
    // Nessun indirizzo base di partenza; ogni test imposta quello che gli serve.
    vi.stubEnv('AUTH_URL', 'x')
    vi.stubEnv('NEXTAUTH_URL', 'x')
    delete process.env.AUTH_URL
    delete process.env.NEXTAUTH_URL
  })
  afterEach(() => vi.unstubAllEnvs())

  it('records server_configuration when no base URL is set', async () => {
    expect(await sendInvitationEmail(invitation)).toEqual({ ok: false, code: 'server_configuration' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: false, code: 'server_configuration' })
  })

  it('sends the email with the set-password link and records the delivery', async () => {
    vi.stubEnv('AUTH_URL', 'https://app.example.it/')
    sendEmail.mockResolvedValue(undefined)

    expect(await sendInvitationEmail(invitation)).toEqual({ ok: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe('persona@example.test')
    expect(message.subject).toBe('Benvenuto in Construct — Imposta la tua password')
    expect(message.html).toContain('https://app.example.it/set-password?token=abc')
    expect(message.text).toContain('https://app.example.it/set-password?token=abc')
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: true })
  })

  it('falls back to NEXTAUTH_URL when AUTH_URL is not set', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://legacy.example.it')
    sendEmail.mockResolvedValue(undefined)

    expect(await sendInvitationEmail(invitation)).toEqual({ ok: true })
    expect(sendEmail.mock.calls[0][0].html).toContain('https://legacy.example.it/set-password?token=abc')
  })

  it('records email_delivery_failed when the mailer throws', async () => {
    vi.stubEnv('AUTH_URL', 'https://app.example.it')
    sendEmail.mockRejectedValue(new Error('smtp down'))

    expect(await sendInvitationEmail(invitation)).toEqual({ ok: false, code: 'email_delivery_failed' })
    expect(recordInvitationDelivery).toHaveBeenCalledWith('token-1', { ok: false, code: 'email_delivery_failed' })
  })
})
