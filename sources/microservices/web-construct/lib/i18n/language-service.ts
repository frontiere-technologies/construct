import { cache } from 'react'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { FALLBACK_LANGUAGE, type LanguageDto } from './types'

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
 */
export const getLanguageStats = cache(async (): Promise<Map<string, LanguageStats>> => {
  try {
    const [[{ total }], perLanguage] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(translationKey),
      db
        .select({ code: appLanguage.code, translated: sql<number>`count(${translationValue.idTranslationValue})::int` })
        .from(appLanguage)
        .leftJoin(translationValue, eq(translationValue.idLanguage, appLanguage.idLanguage))
        .groupBy(appLanguage.code),
    ])
    return new Map(perLanguage.map(r => [r.code, { code: r.code, translated: r.translated, missing: total - r.translated }]))
  } catch (err) {
    log.error({ err }, 'failed to compute language stats')
    return new Map()
  }
})
