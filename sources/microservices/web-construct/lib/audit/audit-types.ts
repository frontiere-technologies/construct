import type { BaseTx, GlobalTx, TenantTx } from '@/lib/db/tenant-db'
import type { Actor } from '@/lib/rbac/actor'
import type { PlatformActor } from '@/lib/rbac/platform-admin'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/**
 * I tipi del registro delle modifiche (specifica 2026-10-26, §2.4, MT5-DEC-14, MT5-DEC-15, 0057).
 * Il codice delle operazioni vive solo qui: una voce nuova si aggiunge a questa unione, e un codice
 * che non c'è non compila.
 */

/** La veste di chi ha agito: la persona del tenant, la piattaforma (console o assistenza), un comando di db.mjs. */
export type AuditActorKind = 'person' | 'platform' | 'command'

/** Chi ha agito, com'è scritto nella voce: id ed email al momento dell'azione. Per un comando la persona può mancare. */
export type AuditActor = { userId: string | null; email: string | null; kind: AuditActorKind }

/**
 * I codici stabili delle operazioni. Un codice scritto una volta non cambia più: chi legge il
 * registro (e i test) si fida del nome.
 */
export const AUDIT_OPERATIONS = [
  'role.create', 'role.rename', 'role.permissions', 'role.functionalities', 'role.delete',
  'menu.create', 'menu.update', 'menu.move', 'menu.delete',
  'member.add', 'member.roles', 'member.status', 'member.invite', 'member.join',
  'theme.save', 'settings.self_registration',
  'support.grant', 'support.revoke', 'support.enter', 'support.exit',
  'tenant.create', 'tenant.status', 'tenant.host.add', 'tenant.host.remove', 'tenant.host.primary',
  'tenant.admin.add', 'tenant.invite.resend',
  'platform.admin.add', 'platform.admin.remove',
  'language.create', 'language.update', 'language.active', 'language.default', 'language.delete',
  'translation.key.create', 'translation.key.delete', 'translation.save',
] as const

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number]

/** Che cosa è successo: l'operazione, l'oggetto toccato (tipo e id) e i valori essenziali. */
export type AuditEvent = {
  operation: AuditOperation
  objectType: string
  objectId: string | number | null
  /** Valori essenziali, prima/dopo dove ha senso. Passano da `sanitizeAuditDetails`: mai password, token o link. */
  details?: Record<string, unknown>
}

/**
 * La transazione dell'identità di piattaforma (`PlatformTx` di lib/platform/db.ts), descritta qui
 * per struttura. Solo lib/platform/** può nominare quel modulo, nemmeno per il solo tipo
 * (guards/platform-boundary.test.ts), e il registro non ha bisogno della porta: gli basta il tipo
 * della transazione. lib/platform/audit-types.test.ts verifica a compilazione che le due forme
 * coincidano.
 */
export type PlatformAuditTx = BaseTx & { readonly __txBrand: 'PlatformTx' }

/** Dove si scrive una voce del tenant: la transazione di un tenant (la RLS vale) o quella della piattaforma con il tenant impostato. */
export type TenantAuditTx = TenantTx | PlatformAuditTx

/** Dove si scrive una voce della piattaforma: la transazione globale dell'app (lingue e traduzioni) o quella della piattaforma. */
export type PlatformAuditWriteTx = GlobalTx | PlatformAuditTx

export type PlatformAuditEvent = AuditEvent & { tenantId?: TenantId | null }

export type AuditActorSource = Actor | PlatformActor

/**
 * Toglie dai dettagli di una voce le chiavi che porterebbero un segreto (MT5-RISK-4): quelle il cui
 * nome contiene `password`, `token`, `link` o `secret`, in qualunque combinazione di maiuscole, a
 * ogni livello (oggetti e liste annidati). Il registro non si cancella né si corregge: ciò che
 * entra, resta. Il controllo è per nome e non guarda i valori, quindi chi scrive una voce non deve
 * mai mettere un segreto sotto un altro nome.
 */
const FORBIDDEN_KEY = /password|token|link|secret/i

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, inner]) => !FORBIDDEN_KEY.test(key) && inner !== undefined)
        .map(([key, inner]) => [key, clean(inner)]),
    )
  }
  return value
}

export function sanitizeAuditDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  return details ? (clean(details) as Record<string, unknown>) : {}
}

/**
 * Come si presenta nel registro chi agisce. L'attore di un tenant è una persona; l'amministratore
 * di piattaforma che agisce dalla console è la piattaforma (MT5-DEC-14). L'attore del tenant non
 * porta l'email (si legge dall'account al momento della scrittura, `recordTenantAudit`): qui resta
 * nulla, e la voce la completa con la stessa istruzione.
 *
 * Il caso dell'assistenza (pezzo 5a, MT5-DEC-12, MT5-DEC-14): l'amministratore di piattaforma in
 * assistenza è un attore del tenant (ha il tenant e i permessi), ma nel registro agisce come
 * piattaforma, con il proprio account. Lo dice il discriminante esplicito `support`, che solo
 * `resolveSupportActor` mette: mai la forma dell'oggetto.
 */
export function auditActorOf(actor: AuditActorSource): AuditActor {
  // Si distingue da ciò che solo l'attore del tenant ha, il tenant (`tenantId`): un campo che un
  // giorno si aggiungesse a `PlatformActor`, come l'email, non cambia la veste di nessuno.
  if ('tenantId' in actor) return { userId: actor.userId, email: null, kind: actor.support === true ? 'platform' : 'person' }
  return { userId: actor.userId, email: actor.email, kind: 'platform' }
}
