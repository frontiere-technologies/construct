import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'
import { recordInvitationDelivery, type PreparedInvitation } from '@/lib/auth-invitations'

const log = createLogger('invitation-email')

const SUBJECT = 'Benvenuto in Construct — Imposta la tua password'

export type InvitationEmailResult = { ok: true } | { ok: false; code: string }

/** Il link per impostare la password, senza doppia barra tra l'indirizzo base e il percorso. */
export function buildSetPasswordLink(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/$/, '')}/set-password?token=${rawToken}`
}

function buildHtml(setPasswordUrl: string): string {
  return `
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
      `
}

function buildText(setPasswordUrl: string): string {
  return `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`
}

/**
 * Manda l'email di invito e registra l'esito sul token (`recordInvitationDelivery`). Non lancia:
 * chi chiama decide cosa rispondere in base al risultato.
 */
export async function sendInvitationEmail(invitation: PreparedInvitation): Promise<InvitationEmailResult> {
  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'server_configuration' })
    return { ok: false, code: 'server_configuration' }
  }

  const setPasswordUrl = buildSetPasswordLink(baseUrl, invitation.rawToken)
  if (process.env.NODE_ENV === 'development') {
    log.info({ setPasswordUrl }, 'dev: set-password link')
  }

  try {
    await sendEmail({
      to: invitation.email,
      subject: SUBJECT,
      html: buildHtml(setPasswordUrl),
      text: buildText(setPasswordUrl),
    })
    await recordInvitationDelivery(invitation.tokenId, { ok: true })
    return { ok: true }
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send invitation email')
    await recordInvitationDelivery(invitation.tokenId, { ok: false, code: 'email_delivery_failed' })
    return { ok: false, code: 'email_delivery_failed' }
  }
}
