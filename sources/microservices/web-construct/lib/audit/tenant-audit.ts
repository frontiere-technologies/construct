import { tenantAuditEvent } from '@/lib/db/schema'
import { auditRow } from './audit-row'
import type { AuditActor, AuditEvent, TenantAuditTx } from './audit-types'

/**
 * Scrive una voce nel registro del tenant (specifica 2026-10-26, §2.4, MT5-DEC-14, MT5-DEC-15).
 * Va chiamata **dentro la transazione della modifica**: se la modifica fallisce la voce sparisce
 * con lei, e se la voce non si scrive la modifica non avviene. Non apre mai una transazione sua.
 *
 * Il tenant è quello della transazione (`id_tenant` ha per default il tenant corrente, e la RLS
 * forzata lo impone): con `TenantTx` è quello di `withTenant`; con la transazione della piattaforma
 * va aperta `withPlatform(fn, tenantId)`, altrimenti non c'è un tenant e la scrittura fallisce.
 * L'app ha solo `insert` e `select` sulla tabella: niente `returning`.
 */
export async function recordTenantAudit(tx: TenantAuditTx, actor: AuditActor, event: AuditEvent): Promise<void> {
  await tx.insert(tenantAuditEvent).values(auditRow(actor, event))
}
