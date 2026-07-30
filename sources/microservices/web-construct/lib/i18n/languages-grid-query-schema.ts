import { z } from 'zod'
import type { LanguagesQuery } from './types'
import { isSupportedLanguageCreatedTo } from './language-grid-boundaries'

export const LANGUAGES_GRID_MAX_PAGE_SIZE = 200

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

const countSchema = z.number().finite().int().nonnegative()

export const languagesGridQuerySchema: z.ZodType<LanguagesQuery> = z.object({
  page: z.number().finite().int().nonnegative(),
  size: z.number().finite().int().positive().max(LANGUAGES_GRID_MAX_PAGE_SIZE),
  codeSearch: textSearchSchema.optional(),
  localeSearch: textSearchSchema.optional(),
  nameSearch: textSearchSchema.optional(),
  nativeNameSearch: textSearchSchema.optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  translatedMin: countSchema.optional(),
  translatedMax: countSchema.optional(),
  missingMin: countSchema.optional(),
  missingMax: countSchema.optional(),
  createdFrom: dateSchema.optional(),
  createdTo: dateSchema.refine(
    isSupportedLanguageCreatedTo,
    'createdTo exceeds the supported inclusive upper bound',
  ).optional(),
  sort: z.enum(['code', 'locale', 'name', 'nativeName', 'isActive', 'isDefault', 'createdAt']).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
}).superRefine((query, context) => {
  const validateRange = (
    min: number | string | undefined,
    max: number | string | undefined,
    path: string,
  ) => {
    if (min != null && max != null && min > max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Range bounds must be ordered', path: [path] })
    }
  }

  validateRange(query.translatedMin, query.translatedMax, 'translatedMax')
  validateRange(query.missingMin, query.missingMax, 'missingMax')
  validateRange(query.createdFrom, query.createdTo, 'createdTo')
})
