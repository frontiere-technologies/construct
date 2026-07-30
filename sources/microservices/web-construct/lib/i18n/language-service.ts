import { cache } from 'react'
import { and, asc, count, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { FALLBACK_LANGUAGE, type LanguageDto, type LanguagePageItemDto, type LanguagesPage, type LanguagesQuery } from './types'
import { normalizeTextSearch } from '@/lib/grid-text-search'

const log = createLogger('i18n-language-service')

function toDto(row: typeof appLanguage.$inferSelect): LanguageDto {
  return {
    id: Number(row.idLanguage),
    code: row.code,
    locale: row.locale,
    name: row.name,
    nativeName: row.nativeName,
    isActive: row.isActive,
    isDefault: row.isDefault,
  }
}

/**
 * Every language, ordered by code. Request-scoped via React `cache()`: the root
 * layout, the switcher and the admin pages all need it and must not each query.
 *
 * Never throws: §6.2 requires that a languages-table problem degrade to the
 * fallback language instead of failing the render.
 */
export const listLanguages = cache(async (): Promise<LanguageDto[]> => {
  try {
    const rows = await db.select().from(appLanguage).orderBy(asc(appLanguage.code))
    return rows.map(toDto)
  } catch (err) {
    log.error({ err }, 'failed to load languages — falling back to the built-in default')
    return [FALLBACK_LANGUAGE]
  }
})

export const listActiveLanguages = cache(async (): Promise<LanguageDto[]> =>
  (await listLanguages()).filter(l => l.isActive))

export const getDefaultLanguage = cache(async (): Promise<LanguageDto> => {
  const languages = await listLanguages()
  return languages.find(l => l.isDefault && l.isActive)
    ?? languages.find(l => l.isActive)
    ?? FALLBACK_LANGUAGE
})

export const getLanguageByCode = cache(async (code: string): Promise<LanguageDto | null> =>
  (await listLanguages()).find(l => l.code === code) ?? null)

export interface LanguageStats {
  code: string
  translated: number
  missing: number
}

/**
 * Per-language translated / missing counts for the admin grid (§2.4).
 * `total keys − values for this language` is the missing count; a value row
 * cannot exist without its key (FK), so the subtraction is exact.
 *
 * An empty value does not count as translated: `createTranslator` treats `''`
 * as absent and falls back to the default language, so a blank row is a missing
 * translation as far as the user is concerned. Counting it as present would make
 * this grid disagree with both the translator and the editor's missing/complete
 * filter.
 *
 * Throws on failure rather than degrading, unlike `listLanguages` above: this
 * feeds an admin grid, where "0 translated, 0 missing" and "the query failed"
 * must not look identical.
 */
export const getLanguageStats = cache(async (): Promise<Map<string, LanguageStats>> => {
  try {
    const [[{ total }], perLanguage] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(translationKey),
      db
        .select({ code: appLanguage.code, translated: sql<number>`count(${translationValue.idTranslationValue})::int` })
        .from(appLanguage)
        .leftJoin(
          translationValue,
          and(eq(translationValue.idLanguage, appLanguage.idLanguage), ne(translationValue.value, '')),
        )
        .groupBy(appLanguage.code),
    ])
    return new Map(perLanguage.map(r => [r.code, { code: r.code, translated: r.translated, missing: total - r.translated }]))
  } catch (err) {
    throw new Error(`Failed to compute language stats: ${err instanceof Error ? err.message : String(err)}`)
  }
})

const LANGUAGE_SORT_COLUMN = {
  code: appLanguage.code,
  locale: appLanguage.locale,
  name: appLanguage.name,
  isActive: appLanguage.isActive,
  isDefault: appLanguage.isDefault,
  createdAt: appLanguage.createdAt,
} as const

function sortColumnFor(sort: LanguagesQuery['sort']) {
  // `sort` arrives from a request body, so it is an arbitrary string as far as
  // the runtime is concerned: bare indexing would return Object.prototype for
  // '__proto__' and undefined for anything unrecognised, both of which blow up
  // inside orderBy() rather than degrading.
  return sort && Object.hasOwn(LANGUAGE_SORT_COLUMN, sort)
    ? LANGUAGE_SORT_COLUMN[sort]
    : LANGUAGE_SORT_COLUMN.code
}

/**
 * Page of languages for the admin grid (§2.4), with per-row translated/missing
 * counts folded in from `getLanguageStats`. Unlike `listLanguages` above, this
 * throws on failure: it feeds an admin grid, where "no rows" and "the query
 * failed" must not look identical.
 */
export async function listLanguagesPage(query: LanguagesQuery): Promise<LanguagesPage> {
  const conditions: SQL[] = []
  const textSearch = normalizeTextSearch(query.search)
  if (textSearch) {
    const termConditions = textSearch.conditions.map(term => {
      const pattern = `%${term}%`
      return or(
        sql`${appLanguage.name} ilike ${pattern}`,
        sql`${appLanguage.nativeName} ilike ${pattern}`,
        sql`${appLanguage.code} ilike ${pattern}`,
        sql`${appLanguage.locale} ilike ${pattern}`,
      )!
    })
    conditions.push((textSearch.operator === 'OR' ? or(...termConditions) : and(...termConditions))!)
  }
  if (query.isActive != null) conditions.push(eq(appLanguage.isActive, query.isActive))
  const where = conditions.length ? and(...conditions) : undefined

  const sortCol = sortColumnFor(query.sort)
  const ascending = (query.direction ?? 'ASC') === 'ASC'

  try {
    const [rows, [{ value: total }], stats] = await Promise.all([
      db.select().from(appLanguage).where(where)
        .orderBy(ascending ? asc(sortCol) : desc(sortCol))
        .limit(query.size).offset(query.page * query.size),
      db.select({ value: count() }).from(appLanguage).where(where),
      getLanguageStats(),
    ])
    const elements: LanguagePageItemDto[] = rows.map(row => {
      const stat = stats.get(row.code)
      return {
        ...toDto(row),
        translated: stat?.translated ?? 0,
        missing: stat?.missing ?? 0,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
      }
    })
    return { total, elements }
  } catch (err) {
    throw new Error(`Failed to list languages: ${err instanceof Error ? err.message : String(err)}`)
  }
}
