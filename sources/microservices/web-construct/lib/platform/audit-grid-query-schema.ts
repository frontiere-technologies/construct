import { z } from 'zod'
import { auditQueryShape, checkAuditPeriod } from '@/lib/audit/audit-grid-query-schema'
import type { AuditQuery } from '@/lib/audit/audit-grid-query'

/** Quale registro legge la griglia della console: quello della piattaforma, o (nella scheda del modello) quello del modello. */
export const PLATFORM_AUDIT_SCOPES = ['platform', 'template'] as const
export type PlatformAuditScope = (typeof PLATFORM_AUDIT_SCOPES)[number]

export type PlatformAuditGridQuery = AuditQuery & { scope?: PlatformAuditScope }

/** La richiesta della griglia del registro della console: lo schema della rotta, che non si fida del corpo. */
export const platformAuditGridQuerySchema: z.ZodType<PlatformAuditGridQuery> = z.object({
  ...auditQueryShape,
  scope: z.enum(PLATFORM_AUDIT_SCOPES).optional(),
}).superRefine(checkAuditPeriod)
