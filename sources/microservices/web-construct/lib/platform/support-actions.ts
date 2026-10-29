'use server'

import { auditActorOf, type AuditEvent } from '@/lib/audit/audit-types'
import { recordPlatformAudit } from '@/lib/audit/platform-audit'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { unstable_update } from '@/lib/auth'
import { getSession } from '@/lib/auth-session'
import { requirePlatformAdmin, requireSupportExit, type PlatformActor } from '@/lib/rbac/auth-guard'
import { existingTenantId } from '@/lib/tenancy/platform-tenant'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { selectSupportAccess, supportConditionsHold } from '@/lib/tenancy/support-consent'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { TenantState } from '@/lib/tenancy/tenant-selection'
import { withPlatform, type PlatformTx } from './db'
import { reasonSchema, tenantIdArgSchema } from './tenant-action-schemas'

/**
 * L'ingresso e l'uscita dell'assistenza dalla console (specifica 2026-10-26, §3.2, MT5-DEC-10,
 * MT5-DEC-11, MT5-DEC-19, MT5-DEC-20, MT5-RISK-2). Le porte della piattaforma: la guardia rilegge
 * l'attributo dal database e rifiuta un indirizzo dedicato prima di aprire la transazione con
 * l'identità di piattaforma, che qui scrive solo le voci dei due registri e legge lo stato del
 * permesso. I dati del tenant durante l'assistenza passano invece dalla porta normale dell'app
 * (`withTenant`, con la RLS sul tenant assistito), con l'attore di `resolveSupportActor`.
 *
 * Nessun `redirect()`: le azioni restituiscono lo stato della sessione, e il client carica la home
 * del tenant (o la console, all'uscita) da capo.
 */

/**
 * Il carico di `unstable_update` per il callback jwt: porta una richiesta (entrare, uscire), non
 * campi della sessione, e il tipo di next-auth conosce solo questi. Il callback lo tratta comunque
 * come non fidato (`updateTokenTenant`).
 */
type SessionUpdate = Parameters<typeof unstable_update>[0]
const supportRequest = (user: { supportTenantId: number } | { supportExit: true }) => ({ user }) as unknown as SessionUpdate

/** La stessa voce nei due registri (MT5-DEC-20): della piattaforma (con il tenant toccato) e del tenant (quello della transazione). */
async function recordBoth(tx: PlatformTx, actor: PlatformActor, tenantId: TenantId, event: AuditEvent): Promise<void> {
  await recordPlatformAudit(tx, auditActorOf(actor), { ...event, tenantId })
  await recordTenantAudit(tx, auditActorOf(actor), event)
}

/** Il motivo scritto dell'ingresso (MT5-DEC-9): obbligatorio, finisce nei due registri. */
function parseReason(reason: unknown): string {
  const parsed = reasonSchema.parse(reason)
  if (!parsed) throw new Error("L'accesso di assistenza richiede un motivo")
  return parsed
}

/**
 * Entra in assistenza nel tenant. Da una sessione già in assistenza la guardia rifiuta (la console è
 * chiusa in assistenza): per passare a un altro tenant si esce prima. Nella transazione, prima di scrivere, rilegge con l'istruzione
 * della rivalidazione: permesso valido (o il modello, MT5-DEC-11), tenant attivo, attributo e
 * account, indirizzo principale (MT5-DEC-19). Se manca qualcosa non scrive niente e lancia. Scrive
 * `support.enter` nei due registri, con il motivo e la scadenza del permesso (che alla scadenza
 * naturale basta: non si scrive un'uscita, MT5-DEC-20).
 *
 * Poi chiede al callback jwt di entrare: il callback ci crede solo perché trova questa voce
 * d'ingresso appena scritta, e ricontrolla tutto il resto da sé.
 */
export async function startSupport(tenantId: number, reason: string): Promise<{ state: TenantState }> {
  const actor = await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const text = parseReason(reason)
  const tenantKey = await existingTenantId(id)
  const host = await readRequestHost()

  await withPlatform(async tx => {
    const access = await selectSupportAccess(tx, actor.userId, host)
    if (!supportConditionsHold(access)) throw new Error('support_not_allowed')
    await recordBoth(tx, actor, tenantKey, {
      operation: 'support.enter', objectType: 'tenant', objectId: tenantKey,
      details: { reason: text, until: access.until, template: access.isTemplate },
    })
  }, tenantKey)

  const updated = await unstable_update(supportRequest({ supportTenantId: id }))
  return { state: updated?.user?.tenantState ?? 'none' }
}

/**
 * Esce dall'assistenza (la fascia, «Esci»): `support.exit` nei due registri, poi il token si
 * ricalcola come un accesso e il client carica la console. È l'unica porta della console che la
 * guardia (`requireSupportExit`) accetta in assistenza: a chi è amministratore di piattaforma
 * fuori dall'assistenza (anche se è appena finita da sola, alla scadenza o alla revoca) risponde con
 * lo stato della sessione, senza scrivere niente né lanciare, e il client carica la console come
 * sempre; chi non è amministratore di piattaforma è rifiutato.
 */
export async function endSupport(): Promise<{ state: TenantState }> {
  const actor = await requireSupportExit()
  const session = await getSession()
  const current = session?.user?.tenantState === 'support' && typeof session.user.tenantId === 'number' ? session.user.tenantId : null
  if (current === null) return { state: session?.user?.tenantState ?? 'none' }

  const tenantKey = await existingTenantId(current)
  await withPlatform(tx => recordBoth(tx, actor, tenantKey, { operation: 'support.exit', objectType: 'tenant', objectId: tenantKey }), tenantKey)
  const updated = await unstable_update(supportRequest({ supportExit: true }))
  return { state: updated?.user?.tenantState ?? 'none' }
}
