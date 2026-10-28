import { z } from 'zod'
import { auditQueryShape, checkAuditPeriod } from '@/lib/audit/audit-grid-query-schema'
import type { AuditQuery } from '@/lib/audit/audit-grid-query'

/**
 * Quale registro legge la griglia della console: quello della piattaforma, quello della piattaforma
 * su un solo tenant (la scheda del tenant, MT5-DEC-6), o (nella scheda del modello) quello del modello.
 */
export const PLATFORM_AUDIT_SCOPES = ['platform', 'template', 'tenant'] as const
export type PlatformAuditScope = (typeof PLATFORM_AUDIT_SCOPES)[number]

export type PlatformAuditGridQuery = AuditQuery & { scope?: PlatformAuditScope; tenantId?: number }

/** La richiesta della griglia del registro della console: lo schema della rotta, che non si fida del corpo. */
export const platformAuditGridQuerySchema: z.ZodType<PlatformAuditGridQuery> = z.object({
  ...auditQueryShape,
  scope: z.enum(PLATFORM_AUDIT_SCOPES).optional(),
  tenantId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((query, context) => {
  checkAuditPeriod(query, context)
  // Il tenant si indica solo per `tenant`, e `tenant` lo richiede: nessun id lasciato in giro per gli altri registri.
  if ((query.scope === 'tenant') !== (query.tenantId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'tenantId goes with scope tenant, and only with it', path: ['tenantId'] })
  }
})
