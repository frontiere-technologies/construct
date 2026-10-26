import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'
import { prepareInvitation } from '@/lib/auth-invitations'
import { sendInvitationEmail } from '@/lib/invitation-email'
import { resolveHostTenant } from '@/lib/tenancy/host-tenants'
import { joinTenantByRegistration, MEMBERSHIP_ACTIVE } from '@/lib/tenancy/membership'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { acceptsSelfRegistration } from '@/lib/tenancy/tenant-settings'
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

  // Il tenant dell'indirizzo, letto una volta: decide se la registrazione è accettata, dove entra la
  // persona e l'indirizzo del link (MT4-DEC-9, MT4-DEC-10, MT4-DEC-12). L'intestazione Host sceglie
  // al più il tenant, confrontata con il registro: un Host sconosciuto vale il predefinito, e non
  // entra mai nel link. Se il tenant non accetta registrazioni autonome non si crea nulla, né
  // account né token né email (MT4-OK-5); la risposta resta neutra in ogni caso.
  let tenantId: TenantId
  try {
    tenantId = await resolveHostTenant(await readRequestHost())
    if (!(await acceptsSelfRegistration(tenantId))) {
      log.info('self registration not accepted on this address, skipping')
      return NextResponse.json({ ok: true })
    }
  } catch (err) {
    log.error({ err }, 'failed to read the tenant of the address')
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

  // La persona entra nel tenant prima dell'invio; se la chiamata fallisce, niente email. L'email
  // parte solo se ne esce un'appartenenza attiva in quel tenant: chi è già membro di un altro tenant
  // non entra da solo (lo aggiunge l'amministratore con "Aggiungi persona", e il suo invito lo
  // rimanda l'amministratore del suo tenant), e chi è disattivato qui non entrerebbe comunque.
  let joined
  try {
    joined = await joinTenantByRegistration(invitation.userId, tenantId)
  } catch (err) {
    log.error({ err }, 'failed to join the tenant of the address')
    return NextResponse.json({ ok: true })
  }
  if (joined !== MEMBERSHIP_ACTIVE) {
    log.info({ joined }, 'no active membership in the tenant of the address, skipping the email')
    return NextResponse.json({ ok: true })
  }

  log.info('sending welcome email')
  const result = await sendInvitationEmail(invitation, tenantId)
  if (result.ok) log.info('welcome email sent')

  return NextResponse.json({ ok: true })
}
