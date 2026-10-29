'use server'

import { and, gt, isNotNull, sql } from 'drizzle-orm'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { tenantSettings } from '@/lib/db/schema'
import { withTenant } from '@/lib/db/tenant-db'
import type { Actor } from '@/lib/rbac/actor'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { isoTimestamp } from './support-consent'
import { isSupportDuration, SUPPORT_DURATION_INTERVAL, type SupportDuration } from './support-consent-durations'

/**
 * Il permesso di assistenza alla piattaforma, dalle impostazioni del tenant (specifica 2026-10-26,
 * §3.4, MT5-DEC-10, MT5-DEC-12, MT5-DEC-20). Come `setSelfRegistration`: lo concede chi ha
 * `manage-tenant-settings`, nel tenant del suo attore (nessun parametro dice quale), e la voce va
 * nel registro del tenant nella stessa transazione.
 *
 * La piattaforma in assistenza ha i permessi di un amministratore, `manage-tenant-settings`
 * compreso (le registrazioni autonome sono sue come di ogni amministratore), ma non concede, non
 * allunga e non revoca il permesso che la fa entrare: queste azioni la rifiutano per nome.
 */

/** La piattaforma in assistenza non tocca il proprio permesso (MT5-DEC-12): rifiutata come chi non ha il permesso. */
function refuseDuringSupport(actor: Actor): void {
  if (actor.support === true) throw new Error('Unauthorized')
}

/**
 * Concede l'assistenza per una delle durate (1 ora, 1 giorno, 1 settimana), calcolata con
 * l'orologio del database. Un permesso nuovo sostituisce il precedente, anche se valeva ancora più
 * a lungo: vale l'ultima scelta. Restituisce la scadenza scritta.
 */
export async function grantSupportConsent(duration: SupportDuration): Promise<{ ok: true; until: string }> {
  const actor = await requirePermission('manage-tenant-settings')
  refuseDuringSupport(actor)
  // Un'azione server riceve quello che manda il client, non quello che dice il tipo.
  if (!isSupportDuration(duration)) throw new Error('Durata non valida')
  const interval = SUPPORT_DURATION_INTERVAL[duration]

  return withTenant(actor.tenantId, async tx => {
    const values = {
      supportUntil: sql`now() + ${interval}::interval`,
      supportGrantedBy: actor.userId,
      supportGrantedAt: sql`now()`,
      updatedAt: sql`now()`,
    }
    const [row] = await tx.insert(tenantSettings)
      // `id_tenant` si compila dal contesto (default `app_private.current_tenant_id()`), il conflitto cade sulla chiave.
      .values(values)
      .onConflictDoUpdate({ target: tenantSettings.idTenant, set: values })
      .returning({ until: isoTimestamp(sql`${tenantSettings.supportUntil}`) })
    const until = row.until
    if (until === null) throw new Error('support consent not written')
    await recordTenantAudit(tx, auditActorOf(actor), {
      operation: 'support.grant', objectType: 'tenant_settings', objectId: actor.tenantId,
      details: { duration, until },
    })
    return { ok: true as const, until }
  })
}

/**
 * Revoca il permesso: la piattaforma, se è dentro, esce alla richiesta successiva (MT5-RISK-2). Un
 * permesso che non vale già (mai concesso, scaduto o revocato) non cambia niente e non lascia voci.
 */
export async function revokeSupportConsent(): Promise<{ ok: true }> {
  const actor = await requirePermission('manage-tenant-settings')
  refuseDuringSupport(actor)

  await withTenant(actor.tenantId, async tx => {
    const revoked = await tx.update(tenantSettings)
      .set({ supportUntil: null, updatedAt: sql`now()` })
      .where(and(isNotNull(tenantSettings.supportUntil), gt(tenantSettings.supportUntil, sql`now()`)))
      .returning({ idTenant: tenantSettings.idTenant })
    if (revoked.length === 0) return
    await recordTenantAudit(tx, auditActorOf(actor), {
      operation: 'support.revoke', objectType: 'tenant_settings', objectId: actor.tenantId,
    })
  })
  return { ok: true }
}
