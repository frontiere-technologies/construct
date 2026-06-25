import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:forgot-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', email.toLowerCase().trim())
    .single()

  // Always return 200 — do not leak whether the email exists
  // Only issue reset tokens for credentials users (those with a password_hash)
  if (!user?.id || !user.password_hash) return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

  const { error: insertErr } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: user.id, token, expires_at: expiresAt })

  if (insertErr) {
    log.error({ err: insertErr }, 'failed to create reset token')
    return NextResponse.json({ ok: true })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: user.email,
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
