import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase-server'

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
    console.error('[forgot-password] Failed to create token:', insertErr)
    return NextResponse.json({ ok: true }) // still 200 — don't expose DB errors
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    console.error('[forgot-password] AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error: emailErr } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'noreply@frontiere.io',
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

  if (emailErr) {
    console.error('[forgot-password] Resend error:', emailErr)
  }

  return NextResponse.json({ ok: true })
}
