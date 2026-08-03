import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { prepareInvitation, recordInvitationDelivery } from '@/lib/auth-invitations'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  let actor
  try {
    actor = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user?.email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  let invitation
  try {
    invitation = await prepareInvitation(user.email, actor.userId)
  } catch (err) {
    log.error({ err }, 'failed to prepare invite token')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
  if (!invitation) return NextResponse.json({ ok: true })

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'server_configuration' })
    return NextResponse.json({ error: 'Errore di configurazione del server.' }, { status: 500 })
  }
  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${invitation.rawToken}`

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
    await recordInvitationDelivery(invitation.tokenId, { ok: true })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send invite email')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'email_delivery_failed' })
    return NextResponse.json({ error: 'Errore invio email.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
