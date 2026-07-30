import { cache } from 'react'
import { and, asc, count, desc, eq, gte, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { FALLBACK_LANGUAGE, type LanguageDto, type LanguagePageItemDto, type LanguagesPage, type LanguagesQuery } from './types'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { nextDay } from '@/lib/rbac/date-utils'

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
  nativeName: appLanguage.nativeName,
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

export function languageOrderBy(query: LanguagesQuery): SQL[] {
  const sortCol = sortColumnFor(query.sort)
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  return [ascending ? asc(sortCol) : desc(sortCol), asc(appLanguage.idLanguage)]
}

function textSearchCondition(
  search: LanguagesQuery['nameSearch'],
  column: typeof appLanguage.code | typeof appLanguage.locale | typeof appLanguage.name | typeof appLanguage.nativeName,
): SQL | undefined {
  const textSearch = normalizeTextSearch(search)
  if (!textSearch) return undefined
  const termConditions = textSearch.conditions.map(term =>
    sql`${column} ilike ${`%${escapeLikePattern(term)}%`} escape '\\'`,
  )
  return textSearch.operator === 'OR' ? or(...termConditions)! : and(...termConditions)!
}

function translatedCount(): SQL<number> {
  return sql<number>`(
    select count(*)::int from ${translationValue}
    where ${translationValue.idLanguage} = ${appLanguage.idLanguage}
      and ${translationValue.value} <> ''
  )`
}

function missingCount(): SQL<number> {
  return sql<number>`((select count(*)::int from ${translationKey}) - ${translatedCount()})`
}

export function applyLanguageFilters(query: LanguagesQuery): SQL[] {
  const conditions: SQL[] = []
  const textFilters = [
    textSearchCondition(query.codeSearch, appLanguage.code),
    textSearchCondition(query.localeSearch, appLanguage.locale),
    textSearchCondition(query.nameSearch, appLanguage.name),
    textSearchCondition(query.nativeNameSearch, appLanguage.nativeName),
  ]
  for (const condition of textFilters) if (condition) conditions.push(condition)
  if (query.isActive != null) conditions.push(eq(appLanguage.isActive, query.isActive))
  if (query.isDefault != null) conditions.push(eq(appLanguage.isDefault, query.isDefault))
  if (query.translatedMin != null) conditions.push(gte(translatedCount(), query.translatedMin))
  if (query.translatedMax != null) conditions.push(lte(translatedCount(), query.translatedMax))
  if (query.missingMin != null) conditions.push(gte(missingCount(), query.missingMin))
  if (query.missingMax != null) conditions.push(lte(missingCount(), query.missingMax))
  if (query.createdFrom) conditions.push(gte(appLanguage.createdAt, query.createdFrom))
  if (query.createdTo) conditions.push(lt(appLanguage.createdAt, nextDay(query.createdTo)))
  return conditions
}

/**
 * Page of languages for the admin grid (§2.4), with per-row translated/missing
 * counts folded in from `getLanguageStats`. Unlike `listLanguages` above, this
 * throws on failure: it feeds an admin grid, where "no rows" and "the query
 * failed" must not look identical.
 */
export async function listLanguagesPage(query: LanguagesQuery): Promise<LanguagesPage> {
  const conditions = applyLanguageFilters(query)
  const where = conditions.length ? and(...conditions) : undefined

  const orderBy = languageOrderBy(query)

  try {
    const [rows, [{ value: total }], stats] = await Promise.all([
      db.select().from(appLanguage).where(where)
        .orderBy(...orderBy)
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
