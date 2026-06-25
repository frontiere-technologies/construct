import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, name')
    .eq('id', userId)
    .single()

  if (!user?.email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const { error: insertErr } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: user.id, token, expires_at: expiresAt })

  if (insertErr) {
    console.error('[send-invite] Failed to create token:', insertErr)
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    console.error('[send-invite] AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ error: 'Errore di configurazione del server.' }, { status: 500 })
  }
  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: user.email,
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
  } catch (emailErr) {
    console.error('[send-invite] Failed to send email:', emailErr)
    return NextResponse.json({ error: 'Errore invio email.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
