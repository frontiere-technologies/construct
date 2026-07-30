import { z } from 'zod'
import type { UsersQuery } from './types'
import { isSupportedRbacInclusiveDateTo } from './date-utils'

export const USERS_GRID_MAX_PAGE_SIZE = 100

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

export const usersGridQuerySchema: z.ZodType<UsersQuery> = z.object({
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().nonnegative().max(USERS_GRID_MAX_PAGE_SIZE),
  nameSearch: textSearchSchema.optional(),
  emailSearch: textSearchSchema.optional(),
  roleIds: z.array(z.number().finite().int()).optional(),
  statuses: z.array(z.union([z.literal(1), z.literal(2)])).optional(),
  createdFrom: dateSchema.optional(),
  createdTo: dateSchema.refine(isSupportedRbacInclusiveDateTo, 'createdTo exceeds the supported inclusive upper bound').optional(),
  updatedFrom: dateSchema.optional(),
  updatedTo: dateSchema.refine(isSupportedRbacInclusiveDateTo, 'updatedTo exceeds the supported inclusive upper bound').optional(),
  sort: z.enum(['firstName', 'lastName', 'email', 'dateIns', 'dateMod', 'status']).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
})
