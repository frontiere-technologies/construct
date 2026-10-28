import { and, count, eq } from 'drizzle-orm'
import { auditFilterConditions, auditOrdering, toAuditRow, type AuditColumns } from '@/lib/audit/audit-read-service'
import type { AuditQuery, AuditRow } from '@/lib/audit/audit-grid-query'
import { platformAuditEvent, tenant, tenantAuditEvent } from '@/lib/db/schema'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { existingTenantId, templateTenantId } from '@/lib/tenancy/platform-tenant'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { withPlatform } from './db'

const PLATFORM_COLUMNS: AuditColumns = {
  id: platformAuditEvent.id,
  occurredAt: platformAuditEvent.occurredAt,
  actorEmail: platformAuditEvent.actorEmail,
  operation: platformAuditEvent.operation,
}

const TEMPLATE_COLUMNS: AuditColumns = {
  id: tenantAuditEvent.id,
  occurredAt: tenantAuditEvent.occurredAt,
  actorEmail: tenantAuditEvent.actorEmail,
  operation: tenantAuditEvent.operation,
}

/**
 * Il registro della piattaforma per la console (specifica 2026-10-26, MT5-DEC-16): solo la tabella
 * `platform_audit_event`, mai le voci dei tenant (la piattaforma non vede cosa fanno le persone
 * dentro i tenant, MT5-OK-2). Una porta della piattaforma: verifica l'amministratore prima di aprire
 * la transazione con l'identità di piattaforma (MT5-RISK-1). Il tenant toccato, se c'è, si legge
 * dalla tabella globale dei tenant (nome e basta).
 */
export async function listPlatformAudit(query: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  await requirePlatformAdmin()
  return readPlatformAudit(query, undefined)
}

/**
 * Le voci della piattaforma su un solo tenant (la scheda del tenant, MT5-DEC-6): sempre e solo
 * `platform_audit_event` con `id_tenant` uguale a quello, mai le voci di tenant. L'id arriva dalla
 * richiesta: diventa un tenant solo se il registro dei tenant lo conosce, altrimenti lancia
 * `tenant_not_found`. L'amministratore si verifica prima di leggere i tenant e di aprire la transazione.
 */
export async function listPlatformAuditForTenant(rawTenantId: number, query: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  await requirePlatformAdmin()
  const tenantKey = await existingTenantId(rawTenantId)
  return readPlatformAudit(query, tenantKey)
}

async function readPlatformAudit(query: AuditQuery, onlyTenant: TenantId | undefined): Promise<{ rows: AuditRow[]; total: number }> {
  const filters = auditFilterConditions(PLATFORM_COLUMNS, query)
  const where = onlyTenant === undefined ? and(...filters) : and(eq(platformAuditEvent.idTenant, onlyTenant), ...filters)
  return withPlatform(async tx => {
    // Dentro una transazione le letture vanno in serie sulla stessa connessione.
    const page = await tx.select({
      id: platformAuditEvent.id, occurredAt: platformAuditEvent.occurredAt, actorEmail: platformAuditEvent.actorEmail,
      actorKind: platformAuditEvent.actorKind, operation: platformAuditEvent.operation,
      objectType: platformAuditEvent.objectType, objectId: platformAuditEvent.objectId, details: platformAuditEvent.details,
      tenantId: platformAuditEvent.idTenant, tenantName: tenant.name,
    })
      .from(platformAuditEvent)
      .leftJoin(tenant, eq(tenant.id, platformAuditEvent.idTenant))
      .where(where)
      .orderBy(...auditOrdering(PLATFORM_COLUMNS, query))
      .limit(query.size)
      .offset(query.page * query.size)
    const [{ value: total }] = await tx.select({ value: count() }).from(platformAuditEvent).where(where)
    return {
      rows: page.map(row => ({ ...toAuditRow(row), tenantId: row.tenantId, tenantName: row.tenantName })),
      total,
    }
  })
}

/**
 * Il registro del modello (MT5-DEC-21), per la scheda del modello nella console: il modello non ha
 * persone né dati di clienti, e le modifiche fatte lì finiscono nel suo registro di tenant, che la
 * piattaforma legge con la transazione impostata sul tenant del modello. È l'unico registro di
 * tenant che la console legge senza un permesso di assistenza; di nessun altro tenant.
 */
export async function listTemplateAudit(query: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  await requirePlatformAdmin()
  const templateId = await templateTenantId()

  const where = and(eq(tenantAuditEvent.idTenant, templateId), ...auditFilterConditions(TEMPLATE_COLUMNS, query))
  return withPlatform(async tx => {
    const page = await tx.select({
      id: tenantAuditEvent.id, occurredAt: tenantAuditEvent.occurredAt, actorEmail: tenantAuditEvent.actorEmail,
      actorKind: tenantAuditEvent.actorKind, operation: tenantAuditEvent.operation, objectType: tenantAuditEvent.objectType,
      objectId: tenantAuditEvent.objectId, details: tenantAuditEvent.details,
    })
      .from(tenantAuditEvent)
      .where(where)
      .orderBy(...auditOrdering(TEMPLATE_COLUMNS, query))
      .limit(query.size)
      .offset(query.page * query.size)
    const [{ value: total }] = await tx.select({ value: count() }).from(tenantAuditEvent).where(where)
    return { rows: page.map(toAuditRow), total }
  }, templateId)
}
