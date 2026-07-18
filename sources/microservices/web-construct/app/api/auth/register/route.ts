import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, allowedDomains, passwordSetTokens } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:register')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email.toLowerCase().trim()
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

  // Duplicate email check
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing?.id) {
    log.info('email already registered, skipping')
    return NextResponse.json({ ok: true })
  }

  // Create user
  let newUser: { id: string } | undefined
  try {
    ;[newUser] = await db.insert(users).values({ email: normalizedEmail, authProvider: 'credentials' }).returning({ id: users.id })
  } catch (err) {
    log.error({ err }, 'failed to create user')
    return NextResponse.json({ ok: true })
  }
  if (!newUser?.id) {
    log.error('failed to create user')
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: newUser.id }, 'user created')

  // Create set-password token (48h)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  try {
    await db.insert(passwordSetTokens).values({ userId: newUser.id, token, expiresAt })
  } catch (err) {
    log.error({ err }, 'failed to create password token')
    await db.delete(users).where(eq(users.id, newUser.id))
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: newUser.id }, 'password token created')

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`
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
    log.info('welcome email sent')
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send welcome email')
  }

  return NextResponse.json({ ok: true })
}
