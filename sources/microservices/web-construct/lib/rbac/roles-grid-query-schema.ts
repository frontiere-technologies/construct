import { z } from 'zod'
import type { RolesQuery } from './types'

export const ROLES_GRID_MAX_PAGE_SIZE = 100

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

export const rolesGridQuerySchema: z.ZodType<RolesQuery> = z.object({
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().positive().max(ROLES_GRID_MAX_PAGE_SIZE),
  search: textSearchSchema.optional(),
  idMin: z.number().finite().optional(),
  idMax: z.number().finite().optional(),
  associatedUsersMin: z.number().finite().optional(),
  associatedUsersMax: z.number().finite().optional(),
  hasPermission: z.boolean().optional(),
  startDateIns: dateSchema.optional(),
  endDateIns: dateSchema.optional(),
  startDateMod: dateSchema.optional(),
  endDateMod: dateSchema.optional(),
  sort: z.enum(['id', 'description', 'associatedUsers', 'hasPermissions', 'dateIns', 'dateMod']).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
})
