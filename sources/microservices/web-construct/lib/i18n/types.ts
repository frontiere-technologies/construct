/** A language's whole dictionary, flattened: translation key → translated value. */
export type Dictionary = Record<string, string>

export interface LanguageDto {
  id: number
  code: string
  locale: string
  name: string
  nativeName: string
  isActive: boolean
  isDefault: boolean
}

/**
 * Used only when the languages table cannot be read at all (DB down at render
 * time). §6.2 forbids blocking the app on a language problem, so rendering
 * continues in Italian with an empty dictionary — every label then falls back
 * to its key, which is ugly but never fatal.
 */
export const FALLBACK_LANGUAGE: LanguageDto = {
  id: 0, code: 'it', locale: 'it-IT', name: 'Italiano', nativeName: 'Italiano',
  isActive: true, isDefault: true,
}

/** Persistent (1 year) — carries an anonymous visitor's choice across visits. */
export const LANG_COOKIE = 'construct_lang'
/** Session-scoped — set only by an explicit switch, so it outranks the profile. */
export const LANG_SESSION_COOKIE = 'construct_lang_session'
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const MAX_VALUE_LENGTH = 1000
export const MAX_KEY_LENGTH = 200
export const MAX_NAMESPACE_LENGTH = 60
/** Cap on one bulk-save payload (§13.3 payload-size limit). */
export const MAX_BULK_VALUES = 200

export type TranslationParams = Record<string, string | number | Date | null | undefined>
export type TranslateFn = (key: string, params?: TranslationParams) => string

export type LanguageSortField = 'code' | 'locale' | 'name' | 'isActive' | 'isDefault' | 'createdAt'

export interface LanguagesQuery {
  page: number
  size: number
  search?: string
  isActive?: boolean
  sort?: LanguageSortField
  direction?: 'ASC' | 'DESC'
}

export interface LanguagePageItemDto extends LanguageDto {
  translated: number
  missing: number
  createdAt: string | null
  updatedAt: string | null
}

export interface LanguagesPage {
  total: number
  elements: LanguagePageItemDto[]
}

export type TranslationStatusFilter = 'all' | 'missing' | 'complete'
export type TranslationSortField = 'key' | 'namespace' | 'module' | 'updatedAt'

export interface TranslationsQuery {
  page: number
  size: number
  /** Matched against key, description and translated value. */
  search?: string
  /** Restrict the missing/complete check — and the value search — to one language. */
  languageCode?: string
  namespace?: string
  module?: string
  status?: TranslationStatusFilter
  sort?: TranslationSortField
  direction?: 'ASC' | 'DESC'
}

export interface TranslationValueDto {
  id: number
  value: string
  version: number
}

export interface TranslationRowDto {
  id: number
  key: string
  description: string | null
  namespace: string
  module: string | null
  version: number
  updatedAt: string | null
  /** Keyed by language code; a language with no row here is untranslated. */
  values: Record<string, TranslationValueDto>
  missingCodes: string[]
}

export interface TranslationsPage {
  total: number
  elements: TranslationRowDto[]
}

export interface TranslationConflict {
  languageCode: string
  currentValue: string
  attemptedValue: string
}

export interface SaveTranslationsInput {
  keyId: number
  /** The `translation_key.version` the editor loaded — guards description/namespace edits. */
  keyVersion: number
  description: string | null
  namespace: string
  module: string | null
  values: { languageCode: string; value: string; version: number | null }[]
}

export type SaveTranslationsResult =
  | { ok: true }
  | { ok: false; conflicts: TranslationConflict[] }
  | { ok: false; error: string }
