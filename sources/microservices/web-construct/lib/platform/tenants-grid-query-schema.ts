import { z } from 'zod'
import { isSupportedRbacInclusiveDateTo } from '@/lib/rbac/date-utils'
import { TENANT_SORT_FIELDS, TENANT_STATUSES, type PlatformTenantsQuery } from './tenants-grid-query'

export const TENANTS_GRID_MAX_PAGE_SIZE = 200

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }, 'Invalid calendar date')

const textSearchSchema = z.union([
  z.string().min(1),
  z.object({
    operator: z.enum(['AND', 'OR']),
    conditions: z.array(z.string().min(1)).min(1).max(2),
  }),
])

/** La richiesta della griglia dei tenant: lo schema della rotta, che non si fida del corpo. */
export const tenantsGridQuerySchema: z.ZodType<PlatformTenantsQuery> = z.object({
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().positive().max(TENANTS_GRID_MAX_PAGE_SIZE),
  nameSearch: textSearchSchema.optional(),
  slugSearch: textSearchSchema.optional(),
  hostSearch: textSearchSchema.optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  createdFrom: dateSchema.optional(),
  createdTo: dateSchema.refine(isSupportedRbacInclusiveDateTo, 'createdTo exceeds the supported inclusive upper bound').optional(),
  sort: z.enum(TENANT_SORT_FIELDS).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
}).superRefine((query, context) => {
  if (query.createdFrom != null && query.createdTo != null && query.createdFrom > query.createdTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Range bounds must be ordered', path: ['createdTo'] })
  }
})
