import { cache } from 'react'
import { and, asc, count, desc, eq, gte, lt, lte, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { nextDay } from '@/lib/rbac/date-utils'
import { FALLBACK_LANGUAGE, type LanguageDto, type LanguagePageItemDto, type LanguagesPage, type LanguagesQuery } from './types'
import { isSupportedLanguageCreatedTo } from './language-grid-boundaries'

const log = createLogger('i18n-language-service')

type LanguageBaseRow = Pick<typeof appLanguage.$inferSelect,
  'idLanguage' | 'code' | 'locale' | 'name' | 'nativeName' | 'isActive' | 'isDefault'>

function toDto(row: LanguageBaseRow): LanguageDto {
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

interface LanguageSortSource {
  idLanguage: SQLWrapper
  code: SQLWrapper
  locale: SQLWrapper
  name: SQLWrapper
  nativeName: SQLWrapper
  isActive: SQLWrapper
  isDefault: SQLWrapper
  createdAt: SQLWrapper
}

function sortColumnFor(sort: LanguagesQuery['sort'], source: LanguageSortSource = appLanguage) {
  // `sort` arrives from a request body, so it is an arbitrary string as far as
  // the runtime is concerned: bare indexing would return Object.prototype for
  // '__proto__' and undefined for anything unrecognised, both of which blow up
  // inside orderBy() rather than degrading.
  const columns = {
    code: source.code,
    locale: source.locale,
    name: source.name,
    nativeName: source.nativeName,
    isActive: source.isActive,
    isDefault: source.isDefault,
    createdAt: source.createdAt,
  } as const
  return sort && Object.hasOwn(LANGUAGE_SORT_COLUMN, sort) ? columns[sort] : columns.code
}

export function languageOrderBy(query: LanguagesQuery, source: LanguageSortSource = appLanguage): SQL[] {
  const sortCol = sortColumnFor(query.sort, source)
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  return [ascending ? asc(sortCol) : desc(sortCol), asc(source.idLanguage)]
}

function textSearchCondition(
  search: LanguagesQuery['nameSearch'],
  column: SQLWrapper,
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

interface LanguageFilterSource {
  code: SQLWrapper
  locale: SQLWrapper
  name: SQLWrapper
  nativeName: SQLWrapper
  isActive: SQLWrapper
  isDefault: SQLWrapper
  translated: SQLWrapper
  missing: SQLWrapper
  createdAt: SQLWrapper
}

function baseLanguageFilterSource(): LanguageFilterSource {
  return {
    code: appLanguage.code,
    locale: appLanguage.locale,
    name: appLanguage.name,
    nativeName: appLanguage.nativeName,
    isActive: appLanguage.isActive,
    isDefault: appLanguage.isDefault,
    translated: translatedCount(),
    missing: missingCount(),
    createdAt: appLanguage.createdAt,
  }
}

export function applyLanguageFilters(
  query: LanguagesQuery,
  source: LanguageFilterSource = baseLanguageFilterSource(),
): SQL[] {
  const conditions: SQL[] = []
  const textFilters = [
    textSearchCondition(query.codeSearch, source.code),
    textSearchCondition(query.localeSearch, source.locale),
    textSearchCondition(query.nameSearch, source.name),
    textSearchCondition(query.nativeNameSearch, source.nativeName),
  ]
  for (const condition of textFilters) if (condition) conditions.push(condition)
  if (query.isActive != null) conditions.push(eq(source.isActive, query.isActive))
  if (query.isDefault != null) conditions.push(eq(source.isDefault, query.isDefault))
  if (query.translatedMin != null) conditions.push(gte(source.translated, query.translatedMin))
  if (query.translatedMax != null) conditions.push(lte(source.translated, query.translatedMax))
  if (query.missingMin != null) conditions.push(gte(source.missing, query.missingMin))
  if (query.missingMax != null) conditions.push(lte(source.missing, query.missingMax))
  if (query.createdFrom) conditions.push(gte(source.createdAt, query.createdFrom))
  if (query.createdTo) {
    if (!isSupportedLanguageCreatedTo(query.createdTo)) {
      throw new Error('createdTo exceeds the supported inclusive upper bound')
    }
    conditions.push(lt(source.createdAt, nextDay(query.createdTo)))
  }
  return conditions
}

type LanguageQueryExecutor = Pick<typeof db, 'select'>

export function buildLanguageRowsQuery(executor: LanguageQueryExecutor) {
  const languageBase = alias(appLanguage, 'language_base')
  const projectedTranslated = sql<number>`(
    select count(*)::int from ${translationValue}
    where ${sql.raw('"translation_value"."id_language"')} = ${sql.raw('"language_base"."id_language"')}
      and ${sql.raw('"translation_value"."value"')} <> ''
  )`
  const counts = executor.select({
    idLanguage: languageBase.idLanguage,
    code: languageBase.code,
    locale: languageBase.locale,
    name: languageBase.name,
    nativeName: languageBase.nativeName,
    isActive: languageBase.isActive,
    isDefault: languageBase.isDefault,
    createdAt: languageBase.createdAt,
    updatedAt: languageBase.updatedAt,
    translated: projectedTranslated.as('translated'),
    totalKeys: sql<number>`(select count(*)::int from ${translationKey})`.as('total_keys'),
  }).from(languageBase).as('language_counts')

  return executor.select({
    idLanguage: counts.idLanguage,
    code: counts.code,
    locale: counts.locale,
    name: counts.name,
    nativeName: counts.nativeName,
    isActive: counts.isActive,
    isDefault: counts.isDefault,
    createdAt: counts.createdAt,
    updatedAt: counts.updatedAt,
    translated: counts.translated,
    missing: sql<number>`${counts.totalKeys} - ${counts.translated}`.as('missing'),
  }).from(counts)
}

function languageRows(executor: LanguageQueryExecutor) {
  return buildLanguageRowsQuery(executor).as('language_rows')
}

export function buildLanguagePageQuery(executor: LanguageQueryExecutor, query: LanguagesQuery) {
  const source = languageRows(executor)
  const conditions = applyLanguageFilters(query, source)
  const where = conditions.length ? and(...conditions) : undefined
  return executor.select().from(source).where(where)
    .orderBy(...languageOrderBy(query, source))
    .limit(query.size).offset(query.page * query.size)
}

export function buildLanguageTotalQuery(executor: LanguageQueryExecutor, query: LanguagesQuery) {
  const source = languageRows(executor)
  const conditions = applyLanguageFilters(query, source)
  const where = conditions.length ? and(...conditions) : undefined
  return executor.select({ value: count() }).from(source).where(where)
}

/**
 * Page of languages for the admin grid (§2.4). Counts used by filters and counts
 * returned to the client come from the same derived row. Page and total run in
 * one repeatable-read snapshot, including when the requested page is empty.
 */
export async function listLanguagesPage(query: LanguagesQuery): Promise<LanguagesPage> {
  try {
    return await db.transaction(async tx => {
      const rows = await buildLanguagePageQuery(tx, query)
      const [{ value: total }] = await buildLanguageTotalQuery(tx, query)
      const elements: LanguagePageItemDto[] = rows.map(row => ({
        ...toDto(row),
        translated: row.translated,
        missing: row.missing,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
      }))
      return { total, elements }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  } catch (err) {
    throw new Error(`Failed to list languages: ${err instanceof Error ? err.message : String(err)}`)
  }
}
