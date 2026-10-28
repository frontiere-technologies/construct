import { z } from 'zod'
import { isSupportedRbacInclusiveDateTo } from '@/lib/rbac/date-utils'
import { AUDIT_SORT_FIELDS, type AuditQuery } from './audit-grid-query'
import { AUDIT_OPERATIONS } from './audit-types'

export const AUDIT_GRID_MAX_PAGE_SIZE = 200

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }, 'Invalid calendar date')

const textSearchSchema = z.union([
  z.string().min(1).max(200),
  z.object({
    operator: z.enum(['AND', 'OR']),
    conditions: z.array(z.string().min(1).max(200)).min(1).max(2),
  }),
])

/** I campi della richiesta del registro, comuni alle due rotte (tenant e piattaforma). */
export const auditQueryShape = {
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().positive().max(AUDIT_GRID_MAX_PAGE_SIZE),
  actorSearch: textSearchSchema.optional(),
  operation: z.enum(AUDIT_OPERATIONS).optional(),
  from: dateSchema.optional(),
  to: dateSchema.refine(isSupportedRbacInclusiveDateTo, 'to exceeds the supported inclusive upper bound').optional(),
  sort: z.enum(AUDIT_SORT_FIELDS).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
}

/** Il periodo deve essere ordinato: lo stesso controllo per ogni schema che usa `auditQueryShape`. */
export function checkAuditPeriod(query: { from?: string; to?: string }, context: z.RefinementCtx): void {
  if (query.from != null && query.to != null && query.from > query.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Range bounds must be ordered', path: ['to'] })
  }
}

/** La richiesta della griglia del registro: lo schema delle rotte, che non si fida del corpo. */
export const auditGridQuerySchema: z.ZodType<AuditQuery> = z.object(auditQueryShape).superRefine(checkAuditPeriod)
