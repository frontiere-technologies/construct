import { cache } from 'react'
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { listActiveLanguages } from './language-service'
import type {
  LanguageDto, TranslationRowDto, TranslationsPage, TranslationsQuery, TranslationValueDto,
} from './types'
import { isSupportedTranslationUpdatedTo } from './translation-grid-boundaries'

const SORT_COLUMN = {
  key: translationKey.key,
  namespace: translationKey.namespace,
  module: translationKey.module,
  updatedAt: translationKey.updatedAt,
} as const

/**
 * `sort` arrives from a request body, so it is an arbitrary string as far as
 * the runtime is concerned: bare indexing would return Object.prototype for
 * '__proto__' and undefined for anything unrecognised, both of which blow up
 * inside orderBy() rather than degrading. Mirrors `sortColumnFor` in
 * `language-service.ts`.
 */
function sortColumnFor(sort: TranslationsQuery['sort']) {
  return sort && Object.hasOwn(SORT_COLUMN, sort)
    ? SORT_COLUMN[sort]
    : SORT_COLUMN.key
}

export function translationOrderBy(query: TranslationsQuery): SQL[] {
  const sortCol = sortColumnFor(query.sort)
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  return [ascending ? asc(sortCol) : desc(sortCol), asc(translationKey.idTranslationKey)]
}

/**
 * `missing` = the key lacks a value for at least one of the languages in scope
 * (all active ones, or just the selected one).
 *
 * A correlated `count(*)` compared against the number of languages in scope,
 * rather than a JS-side check: the grid pages server-side, so completeness has
 * to be part of the WHERE clause or paging and the total count would both be
 * wrong. The id array is inlined via `sql.raw` because drizzle's `sql` tag has
 * no array helper — the same `::bigint[]` idiom `roles-actions.ts` already uses.
 * The ids come from `listActiveLanguages()`, never from user input.
 */
function statusCondition(status: 'missing' | 'complete', languageIds: number[]): SQL {
  const idArray = sql.raw(`'{${languageIds.join(',')}}'::bigint[]`)
  const translated = sql`(
    select count(*) from ${translationValue} tv
    where tv.id_translation_key = ${translationKey.idTranslationKey}
      and tv.id_language = any(${idArray})
      and tv.value <> ''
  )`
  return status === 'complete'
    ? sql`${translated} = ${languageIds.length}`
    : sql`${translated} < ${languageIds.length}`
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

export function applyTranslationFilters(query: TranslationsQuery, languages: LanguageDto[]): SQL[] {
  const conditions: SQL[] = []
  if (query.namespace) conditions.push(eq(translationKey.namespace, query.namespace))
  if (query.module) conditions.push(eq(translationKey.module, query.module))
  if (query.updatedFrom) conditions.push(gte(translationKey.updatedAt, query.updatedFrom))
  if (query.updatedTo) {
    if (!isSupportedTranslationUpdatedTo(query.updatedTo)) {
      throw new Error('updatedTo exceeds the supported inclusive upper bound')
    }
    conditions.push(lt(translationKey.updatedAt, nextDay(query.updatedTo)))
  }

  const addTextSearch = (search: TranslationsQuery['search'], column: Parameters<typeof ilike>[0]) => {
    const textSearch = normalizeTextSearch(search)
    if (!textSearch) return
    const termConditions = textSearch.conditions.map(term =>
      sql`${column} ilike ${`%${escapeLikePattern(term)}%`} escape '\\'`,
    )
    conditions.push((textSearch.operator === 'OR' ? or(...termConditions) : and(...termConditions))!)
  }

  addTextSearch(query.search, translationKey.key)
  addTextSearch(query.descriptionSearch, translationKey.description)

  for (const [code, search] of Object.entries(query.valueSearches ?? {})) {
    const language = languages.find(candidate => candidate.isActive && candidate.code === code)
    if (!language) continue
    const value = sql<string>`coalesce((
      select ${translationValue.value}
      from ${translationValue}
      where ${translationValue.idTranslationKey} = ${translationKey.idTranslationKey}
        and ${translationValue.idLanguage} = ${language.id}
    ), '')`
    addTextSearch(search, value)
  }

  return conditions
}

export async function listTranslations(query: TranslationsQuery): Promise<TranslationsPage> {
  const languages = await listActiveLanguages()
  const scoped = query.languageCode
    ? languages.filter(l => l.code === query.languageCode)
    : languages
  const languageIds = scoped.map(l => l.id)

  const conditions = applyTranslationFilters(query, languages)
  // `status` can arrive as `'all'` from an untrusted request body even though
  // the grid itself never sends it (`buildTranslationsGridQuery` omits it) —
  // treat that the same as "no status filter" rather than querying for it.
  if (query.status && query.status !== 'all' && languageIds.length) {
    conditions.push(statusCondition(query.status, languageIds))
  }

  const where = conditions.length ? and(...conditions) : undefined
  let keyRows: (typeof translationKey.$inferSelect)[]
  let total: number
  try {
    const page = await db.transaction(async tx => {
      const rows = await tx.select().from(translationKey).where(where)
        .orderBy(...translationOrderBy(query))
        .limit(query.size).offset(query.page * query.size)
      const [{ value }] = await tx.select({ value: count() }).from(translationKey).where(where)
      return { rows, total: value }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    keyRows = page.rows
    total = page.total
  } catch (err) {
    throw new Error(`Failed to list translations: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (keyRows.length === 0) return { total, elements: [] }

  const keyIds = keyRows.map(r => Number(r.idTranslationKey))
  const valueRows = await db
    .select({
      id: translationValue.idTranslationValue,
      keyId: translationValue.idTranslationKey,
      code: appLanguage.code,
      value: translationValue.value,
      version: translationValue.version,
    })
    .from(translationValue)
    .innerJoin(appLanguage, eq(appLanguage.idLanguage, translationValue.idLanguage))
    .where(inArray(translationValue.idTranslationKey, keyIds))

  // Each bucket is created with `Object.create(null)`, not a `{}` literal:
  // `row.code` is DB-sourced, so a bare object would let a code like
  // `__proto__` resolve to Object.prototype instead of being treated as a
  // missing/present language entry.
  const byKey = new Map<number, Record<string, TranslationValueDto>>()
  for (const row of valueRows) {
    const keyId = Number(row.keyId)
    let bucket = byKey.get(keyId)
    if (!bucket) {
      bucket = Object.create(null) as Record<string, TranslationValueDto>
      byKey.set(keyId, bucket)
    }
    bucket[row.code] = { id: Number(row.id), value: row.value, version: row.version }
  }

  const elements: TranslationRowDto[] = keyRows.map(row => {
    const id = Number(row.idTranslationKey)
    // Same rationale as the populated buckets above: a prototype-ful `{}`
    // fallback would let a code like `constructor` resolve to
    // Object.prototype instead of "missing" when `missingCodes` indexes it.
    const values = byKey.get(id) ?? (Object.create(null) as Record<string, TranslationValueDto>)
    return {
      id,
      key: row.key,
      description: row.description,
      namespace: row.namespace,
      module: row.module,
      version: row.version,
      updatedAt: row.updatedAt ?? null,
      values,
      missingCodes: languages.filter(l => !values[l.code]?.value).map(l => l.code),
    }
  })
  return { total, elements }
}

export const listNamespaces = cache(async (): Promise<string[]> => {
  const rows = await db.selectDistinct({ namespace: translationKey.namespace })
    .from(translationKey).orderBy(asc(translationKey.namespace))
  return rows.map(r => r.namespace)
})

export const listModules = cache(async (): Promise<string[]> => {
  const rows = await db.selectDistinct({ module: translationKey.module })
    .from(translationKey).where(isNotNull(translationKey.module)).orderBy(asc(translationKey.module))
  // `isNotNull` already excludes nulls at the SQL level; this narrows the type
  // to match rather than re-filtering behaviour the query already guarantees.
  return rows.map(r => r.module).filter((m): m is string => m !== null)
})
