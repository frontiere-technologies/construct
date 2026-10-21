import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { prepareInvitation } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  const actor = await requirePermission('invite-users').catch(deniedActor)
  if (!actor) return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  const [user] = await withGlobal(tx => tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1))
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

  const result = await sendInvitationEmail(invitation)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code === 'server_configuration' ? 'Errore di configurazione del server.' : 'Errore invio email.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
