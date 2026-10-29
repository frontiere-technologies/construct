import { and, asc, count, desc, eq, gte, lt, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { tenantAuditEvent } from '@/lib/db/schema'
import { withTenant } from '@/lib/db/tenant-db'
import { escapeLikePattern, normalizeTextSearch, type TextSearch } from '@/lib/grid-text-search'
import { nextDay } from '@/lib/rbac/date-utils'
import { requirePermission } from '@/lib/rbac/auth-guard'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { AuditQuery, AuditRow, AuditSortField } from './audit-grid-query'
import { sanitizeAuditDetails, type AuditActorKind, type AuditOperation } from './audit-types'

export type { AuditQuery, AuditRow } from './audit-grid-query'

/**
 * La lettura del registro (specifica 2026-10-26, MT5-DEC-16). Qui vivono il lettore del registro
 * del tenant e le parti che i lettori della piattaforma (`lib/platform/audit-service.ts`) condividono:
 * i filtri, l'ordinamento e la forma della riga. Questo modulo non importa `lib/platform/db`: la porta
 * della piattaforma la apre solo chi sta in `lib/platform/**` (MT5-RISK-1).
 */

/** Le colonne che i filtri e l'ordinamento toccano, uguali nelle due tabelle del registro. */
export interface AuditColumns {
  id: AnyColumn
  occurredAt: AnyColumn
  actorEmail: AnyColumn
  operation: AnyColumn
}

function actorCondition(search: TextSearch | undefined, column: AnyColumn): SQL | undefined {
  const normalized = normalizeTextSearch(search)
  if (!normalized) return undefined
  const terms = normalized.conditions.map(term => sql`${column} ilike ${`%${escapeLikePattern(term)}%`} escape '\\'`)
  return normalized.operator === 'OR' ? or(...terms) : and(...terms)
}

/** I filtri della richiesta come condizioni SQL: mai testo che arriva dalla richiesta dentro l'SQL, solo parametri. */
export function auditFilterConditions(columns: AuditColumns, query: AuditQuery): SQL[] {
  const conditions: SQL[] = []
  const actor = actorCondition(query.actorSearch, columns.actorEmail)
  if (actor) conditions.push(actor)
  if (query.operation) conditions.push(eq(columns.operation, query.operation))
  if (query.from) conditions.push(gte(columns.occurredAt, query.from))
  if (query.to) conditions.push(lt(columns.occurredAt, nextDay(query.to)))
  return conditions
}

/** Ordina per una colonna della lista chiusa; a parità, la voce più recente prima. */
export function auditOrdering(columns: AuditColumns, query: AuditQuery): SQL[] {
  const byField: Record<AuditSortField, AnyColumn> = {
    occurredAt: columns.occurredAt, actor: columns.actorEmail, operation: columns.operation,
  }
  const column = Object.hasOwn(byField, query.sort ?? 'occurredAt') ? byField[query.sort ?? 'occurredAt'] : columns.occurredAt
  const ascending = (query.direction ?? 'DESC') === 'ASC'
  return [ascending ? asc(column) : desc(column), desc(columns.id)]
}

type RawAuditRow = {
  id: number
  occurredAt: string
  actorEmail: string | null
  actorKind: string
  operation: string
  objectType: string | null
  objectId: string | null
  details: unknown
}

/**
 * La riga come la vede chi legge. I dettagli passano da `sanitizeAuditDetails` anche in lettura
 * (difesa in profondità, MT5-RISK-4): se una voce vecchia o scritta altrove portasse un segreto,
 * qui non uscirebbe. Dettagli che non sono un oggetto diventano vuoti.
 */
export function toAuditRow(row: RawAuditRow): AuditRow {
  const details = row.details !== null && typeof row.details === 'object' && !Array.isArray(row.details)
    ? sanitizeAuditDetails(row.details as Record<string, unknown>)
    : {}
  return {
    id: String(row.id),
    occurredAt: new Date(row.occurredAt).toISOString(),
    actorEmail: row.actorEmail,
    actorKind: row.actorKind as AuditActorKind,
    operation: row.operation as AuditOperation,
    objectType: row.objectType,
    objectId: row.objectId,
    details,
  }
}

const TENANT_COLUMNS: AuditColumns = {
  id: tenantAuditEvent.id,
  occurredAt: tenantAuditEvent.occurredAt,
  actorEmail: tenantAuditEvent.actorEmail,
  operation: tenantAuditEvent.operation,
}

/**
 * Il registro del tenant (MT5-DEC-16, MT5-OK-4): le modifiche delle sue persone e tutto ciò che la
 * piattaforma ha fatto nel suo tenant, le voci in assistenza comprese. Una porta con il suo
 * controllo (`read-tenant-audit`), fatto prima di aprire la transazione. La transazione è quella del
 * tenant dell'attore: la RLS forzata tiene fuori le voci di ogni altro tenant, e la condizione
 * sull'id del tenant lo ripete. Un `tenantId` che non è quello dell'attore è un rifiuto, non una
 * lettura di un altro tenant.
 */
export async function listTenantAudit(tenantId: TenantId, query: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  const actor = await requirePermission('read-tenant-audit')
  if (actor.tenantId !== tenantId) throw new Error('Unauthorized')

  const where = and(eq(tenantAuditEvent.idTenant, tenantId), ...auditFilterConditions(TENANT_COLUMNS, query))
  return withTenant(tenantId, async tx => {
    // Dentro una transazione le letture vanno in serie sulla stessa connessione.
    const page = await tx.select({
      id: tenantAuditEvent.id, occurredAt: tenantAuditEvent.occurredAt, actorEmail: tenantAuditEvent.actorEmail,
      actorKind: tenantAuditEvent.actorKind, operation: tenantAuditEvent.operation, objectType: tenantAuditEvent.objectType,
      objectId: tenantAuditEvent.objectId, details: tenantAuditEvent.details,
    })
      .from(tenantAuditEvent)
      .where(where)
      .orderBy(...auditOrdering(TENANT_COLUMNS, query))
      .limit(query.size)
      .offset(query.page * query.size)
    const [{ value: total }] = await tx.select({ value: count() }).from(tenantAuditEvent).where(where)
    return { rows: page.map(toAuditRow), total }
  })
}
