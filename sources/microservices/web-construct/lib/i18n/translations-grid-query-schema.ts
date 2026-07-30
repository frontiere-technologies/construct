import { z } from 'zod'
import type { TranslationsQuery } from './types'
import { isSupportedTranslationUpdatedTo } from './translation-grid-boundaries'

export const TRANSLATIONS_GRID_MAX_PAGE_SIZE = 200

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

export const translationsGridQuerySchema: z.ZodType<TranslationsQuery> = z.object({
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().positive().max(TRANSLATIONS_GRID_MAX_PAGE_SIZE),
  search: textSearchSchema.optional(),
  descriptionSearch: textSearchSchema.optional(),
  valueSearches: z.record(z.string().regex(/^[a-z]{2,3}$/), textSearchSchema).optional(),
  languageCode: z.string().regex(/^[a-z]{2,3}$/).optional(),
  namespace: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  status: z.enum(['all', 'missing', 'complete']).optional(),
  updatedFrom: dateSchema.optional(),
  updatedTo: dateSchema.refine(
    isSupportedTranslationUpdatedTo,
    'updatedTo exceeds the supported inclusive upper bound',
  ).optional(),
  sort: z.enum(['key', 'namespace', 'module', 'updatedAt']).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
}).superRefine((query, context) => {
  if (query.updatedFrom && query.updatedTo && query.updatedFrom > query.updatedTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Range bounds must be ordered',
      path: ['updatedTo'],
    })
  }
})
