import { NextRequest, NextResponse } from 'next/server'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { createLogger } from '@/lib/logger'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { isSelfInSupport } from '@/lib/rbac/support-guards'
import { prepareInvitation } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { tenantMemberEmail } from '@/lib/tenancy/membership'
import { assertTenantActive, TenantInactiveError } from '@/lib/tenancy/tenant-status'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  const actor = await requirePermission('invite-users').catch(deniedActor)
  if (!actor) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }
  // La piattaforma in assistenza non invita il proprio account (un accesso oltre il permesso).
  if (isSelfInSupport(actor, userId)) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })

  // Solo i membri del tenant di chi invita, in qualunque stato: una persona di un altro tenant
  // risponde come un id che non esiste, così la risposta non rivela chi c'è altrove.
  const email = await tenantMemberEmail(actor.tenantId, userId)
  if (!email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  let invitation
  try {
    // Il token e la voce del registro nascono nella stessa transazione, nel tenant di chi invita.
    invitation = await prepareInvitation(email, actor.userId, {
      tenantId: actor.tenantId,
      record: async (tx, prepared) => {
        // Un tenant sospeso o archiviato non manda inviti (MT5-DEC-25): l'errore annulla anche il token.
        await assertTenantActive(tx)
        await recordTenantAudit(tx, auditActorOf(actor), {
          operation: 'member.invite', objectType: 'user', objectId: prepared.userId, details: { expiresAt: prepared.expiresAt },
        })
      },
    })
  } catch (err) {
    if (err instanceof TenantInactiveError) {
      return NextResponse.json({ error: 'Il tenant è sospeso: gli inviti sono bloccati.' }, { status: 409 })
    }
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
