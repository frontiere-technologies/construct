import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'
import { prepareInvitation } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { resolveHostTenant } from '@/lib/tenancy/host-tenants'
import { joinTenantByRegistration } from '@/lib/tenancy/membership'
import { readRequestHost } from '@/lib/tenancy/request-host'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { allowAnonymous } from '@/lib/rbac/access-declarations'

const log = createLogger('auth:register')

export async function POST(req: NextRequest) {
  allowAnonymous()
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email.toLowerCase().trim()
  try {
    await enforceAuthRateLimit({ request: req, scope: 'register', account: normalizedEmail, accountLimit: 5 })
  } catch (err) {
    if (err instanceof AuthRateLimitExceeded) {
      return NextResponse.json({ error: 'Troppe richieste. Riprova più tardi.' }, { status: 429 })
    }
    throw err
  }
  const domain = normalizedEmail.split('@')[1] ?? ''

  log.info({ domain }, 'register attempt')

  // Domain allow-list check
  const [domainRow] = await withGlobal(tx => tx
    .select({ id: allowedDomains.id })
    .from(allowedDomains)
    .where(and(eq(allowedDomains.domain, domain), eq(allowedDomains.active, true)))
    .limit(1))
  if (!domainRow) {
    log.info({ domain }, 'domain not allowed, skipping')
    return NextResponse.json({ ok: true })
  }

  let invitation
  try {
    invitation = await prepareInvitation(normalizedEmail)
  } catch (err) {
    log.error({ err }, 'failed to prepare invitation')
    return NextResponse.json({ ok: true })
  }
  if (!invitation) {
    log.info('existing password-bearing account, skipping')
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: invitation.userId }, 'invitation prepared')

  // La persona entra nel tenant dell'indirizzo prima dell'invio, se quel tenant la accetta
  // (MT4-DEC-9, MT4-DEC-10); se la chiamata fallisce, niente email. La risposta resta neutra in
  // ogni caso. Il link dell'email parte dall'indirizzo principale dello stesso tenant, mai
  // dall'intestazione Host così com'è (MT4-DEC-12): un Host sconosciuto vale il predefinito.
  let tenantId: TenantId
  try {
    tenantId = await resolveHostTenant(await readRequestHost())
    await joinTenantByRegistration(invitation.userId)
  } catch (err) {
    log.error({ err }, 'failed to join the tenant of the address')
    return NextResponse.json({ ok: true })
  }

  log.info('sending welcome email')
  const result = await sendInvitationEmail(invitation, tenantId)
  if (result.ok) log.info('welcome email sent')

  return NextResponse.json({ ok: true })
}
