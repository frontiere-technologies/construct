import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { prepareInvitation } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { tenantMemberEmail } from '@/lib/tenancy/membership'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  const actor = await requirePermission('invite-users').catch(deniedActor)
  if (!actor) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  // Solo i membri del tenant di chi invita, in qualunque stato: una persona di un altro tenant
  // risponde come un id che non esiste, così la risposta non rivela chi c'è altrove.
  const email = await tenantMemberEmail(actor.tenantId, userId)
  if (!email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  let invitation
  try {
    invitation = await prepareInvitation(email, actor.userId)
  } catch (err) {
    log.error({ err }, 'failed to prepare invite token')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
  if (!invitation) return NextResponse.json({ ok: true })

  const result = await sendInvitationEmail(invitation, actor.tenantId)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code === 'server_configuration' ? 'Errore di configurazione del server.' : 'Errore invio email.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
