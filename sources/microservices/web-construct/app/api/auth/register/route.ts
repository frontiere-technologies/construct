import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { allowedDomains } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'
import { prepareInvitation, recordInvitationDelivery } from '@/lib/auth-invitations'

const log = createLogger('auth:register')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email.toLowerCase().trim()
  try {
    await enforceAuthRateLimit({ request: req, scope: 'register', account: normalizedEmail, accountLimit: 5 })
  } catch (err) {
    if (err instanceof AuthRateLimitExceeded) {
      return NextResponse.json({ error: 'Troppe richieste. Riprova più tardi.' }, { status: 429 })
    }
    throw err
  }
  const domain = normalizedEmail.split('@')[1] ?? ''

  log.info({ domain }, 'register attempt')

  // Domain allow-list check
  const [domainRow] = await db
    .select({ id: allowedDomains.id })
    .from(allowedDomains)
    .where(and(eq(allowedDomains.domain, domain), eq(allowedDomains.active, true)))
    .limit(1)
  if (!domainRow) {
    log.info({ domain }, 'domain not allowed, skipping')
    return NextResponse.json({ ok: true })
  }

  let invitation
  try {
    invitation = await prepareInvitation(normalizedEmail)
  } catch (err) {
    log.error({ err }, 'failed to prepare invitation')
    return NextResponse.json({ ok: true })
  }
  if (!invitation) {
    log.info('existing password-bearing account, skipping')
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: invitation.userId }, 'invitation prepared')

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'server_configuration' })
    return NextResponse.json({ ok: true })
  }

  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${invitation.rawToken}`
  if (process.env.NODE_ENV === 'development') {
    log.info({ setPasswordUrl }, 'dev: set-password link')
  }
  log.info('sending welcome email')

  try {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })
    await recordInvitationDelivery(invitation.tokenId, { ok: true })
    log.info('welcome email sent')
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send welcome email')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'email_delivery_failed' })
  }

  return NextResponse.json({ ok: true })
}
