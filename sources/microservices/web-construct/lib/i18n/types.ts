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
/** Cap on one bulk-save payload (§13.3 payload-size limit). */
export const MAX_BULK_VALUES = 200

export type TranslationParams = Record<string, string | number | Date | null | undefined>
export type TranslateFn = (key: string, params?: TranslationParams) => string
