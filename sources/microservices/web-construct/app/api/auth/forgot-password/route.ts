import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { users, passwordSetTokens } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'
import { allowAnonymous } from '@/lib/rbac/access-declarations'
import { resolveHostTenant } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { tenantBaseUrl } from '@/lib/tenancy/tenant-base-url'

const log = createLogger('auth:forgot-password')

export async function POST(req: NextRequest) {
  allowAnonymous()
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  try {
    await enforceAuthRateLimit({ request: req, scope: 'forgot-password', account: normalizedEmail, accountLimit: 5 })
  } catch (err) {
    if (err instanceof AuthRateLimitExceeded) {
      return NextResponse.json({ error: 'Troppe richieste. Riprova più tardi.' }, { status: 429 })
    }
    throw err
  }

  const [user] = await withGlobal(tx => tx
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1))

  // Always return 200 — do not leak whether the email exists
  // Only issue reset tokens for credentials users (those with a passwordHash)
  if (!user?.id || !user.passwordHash) return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

  try {
    await withGlobal(tx => tx.insert(passwordSetTokens).values({ userId: user.id, token, expiresAt }))
  } catch (err) {
    log.error({ err }, 'failed to create reset token')
    return NextResponse.json({ ok: true })
  }

  // Il link parte dall'indirizzo principale del tenant dell'indirizzo della richiesta (MT4-DEC-11,
  // MT4-DEC-12): l'intestazione Host sceglie al più il tenant, confrontata con il registro, e non
  // entra mai nel link. Un Host sconosciuto (evil.example) vale il predefinito, cioè AUTH_URL.
  let baseUrl: string
  try {
    baseUrl = await tenantBaseUrl(await resolveHostTenant(await readRequestHost()))
  } catch (err) {
    log.error({ err }, 'base URL for the reset link not available')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`
  if (process.env.NODE_ENV === 'development') {
    log.info({ resetUrl }, 'dev: reset-password link')
  }

  try {
    await sendEmail({
      to: user.email!,
      subject: 'Reimposta la tua password — Construct',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Reimposta la tua password</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Hai richiesto il reset della password. Clicca sul pulsante qui sotto per impostarne una nuova.
            Il link è valido per 2 ore.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Reimposta la password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non hai richiesto il reset, ignora questa email. La tua password non verrà modificata.
          </p>
        </div>
      `,
      text: `Hai richiesto il reset della password su Construct.\n\nReimposta la tua password al seguente link (valido 2 ore):\n${resetUrl}\n\nSe non hai richiesto il reset, ignora questa email.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send reset email')
  }

  return NextResponse.json({ ok: true })
}
