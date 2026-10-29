import { platformAuditEvent } from '@/lib/db/schema'
import { auditRow } from './audit-row'
import type { AuditActor, PlatformAuditEvent, PlatformAuditWriteTx } from './audit-types'

/**
 * Scrive una voce nel registro della piattaforma (specifica 2026-10-26, §2.4, MT5-DEC-15,
 * MT5-DEC-24). Come `recordTenantAudit`, dentro la transazione della modifica. Accetta la
 * transazione globale dell'app (`withGlobal`: lingue e traduzioni, dove il ruolo dell'app ha il
 * solo `insert`) e quella della piattaforma (comandi della console). `tenantId` è il tenant toccato,
 * se c'è. La tabella non si può rileggere dall'app: niente `returning`.
 */
export async function recordPlatformAudit(
  tx: PlatformAuditWriteTx,
  actor: AuditActor,
  event: PlatformAuditEvent,
): Promise<void> {
  await tx.insert(platformAuditEvent).values({ ...auditRow(actor, event), idTenant: event.tenantId ?? null })
}
