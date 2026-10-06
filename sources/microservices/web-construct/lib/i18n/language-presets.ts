/**
 * The languages offered by the "Lingua" picker in Admin -> Lingue -> Nuova lingua.
 *
 * Only code and default locale live here: the names are computed with
 * `Intl.DisplayNames` at render time, so they follow the interface language
 * without a translation key per language. A minor language is not missing from
 * the list by mistake — "Altra lingua…" leaves the four fields to fill by hand.
 *
 * Every entry must pass `languageInputSchema` (lib/i18n/language-rules.ts); the
 * test next to this file checks it.
 */
export interface LanguagePreset {
  code: string
  locale: string
}

export interface LanguagePresetOption extends LanguagePreset {
  /** The language's name in the interface language, e.g. "Tedesco" with an Italian UI. */
  name: string
  /** The language's name in the language itself, e.g. "Deutsch". */
  nativeName: string
}

export const LANGUAGE_PRESETS: readonly LanguagePreset[] = [
  { code: 'it', locale: 'it-IT' },
  { code: 'en', locale: 'en-US' },
  { code: 'fr', locale: 'fr-FR' },
  { code: 'de', locale: 'de-DE' },
  { code: 'es', locale: 'es-ES' },
  { code: 'pt', locale: 'pt-PT' },
  { code: 'nl', locale: 'nl-NL' },
  { code: 'pl', locale: 'pl-PL' },
  { code: 'ro', locale: 'ro-RO' },
  { code: 'el', locale: 'el-GR' },
  { code: 'sv', locale: 'sv-SE' },
  { code: 'da', locale: 'da-DK' },
  { code: 'fi', locale: 'fi-FI' },
  { code: 'nb', locale: 'nb-NO' },
  { code: 'cs', locale: 'cs-CZ' },
  { code: 'sk', locale: 'sk-SK' },
  { code: 'hu', locale: 'hu-HU' },
  { code: 'hr', locale: 'hr-HR' },
  { code: 'sl', locale: 'sl-SI' },
  { code: 'bg', locale: 'bg-BG' },
  { code: 'uk', locale: 'uk-UA' },
  { code: 'ru', locale: 'ru-RU' },
  { code: 'tr', locale: 'tr-TR' },
  { code: 'ar', locale: 'ar-SA' },
  { code: 'he', locale: 'he-IL' },
  { code: 'hi', locale: 'hi-IN' },
  { code: 'zh', locale: 'zh-CN' },
  { code: 'ja', locale: 'ja-JP' },
  { code: 'ko', locale: 'ko-KR' },
  { code: 'id', locale: 'id-ID' },
  { code: 'vi', locale: 'vi-VN' },
  { code: 'th', locale: 'th-TH' },
]

/** First letter upper-cased with the rules of `locale`; by code point, not by UTF-16 unit. */
function capitalise(text: string, locale: string): string {
  const [first = '', ...rest] = Array.from(text)
  return first.toLocaleUpperCase(locale) + rest.join('')
}

/**
 * The name of `code` as `displayLocale` writes it. The code, not the full
 * locale, is what is named: "Portoghese", not "Portoghese (Portogallo)".
 * An unusable locale degrades to the code rather than breaking the dialog.
 */
function languageName(code: string, displayLocale: string): string {
  try {
    const name = new Intl.DisplayNames([displayLocale], { type: 'language' }).of(code)
    return capitalise(name ?? code, displayLocale)
  } catch {
    return code
  }
}

/** Lowercase, trimmed, without diacritics: "Español" and "espan" meet halfway. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** The presets named for an interface in `uiLocale`, sorted by that name. */
export function languagePresetOptions(uiLocale: string): LanguagePresetOption[] {
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(uiLocale)
  } catch {
    collator = new Intl.Collator()
  }
  return LANGUAGE_PRESETS
    .map(({ code, locale }) => ({
      code,
      locale,
      name: languageName(code, uiLocale),
      nativeName: languageName(code, locale),
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/**
 * The options whose interface-language name or native name contains `query`,
 * or whose code starts with it. Order is preserved; an empty query keeps all.
 */
export function filterLanguagePresets(options: LanguagePresetOption[], query: string): LanguagePresetOption[] {
  const needle = normalizeForSearch(query)
  if (!needle) return options
  return options.filter(o =>
    normalizeForSearch(o.name).includes(needle)
    || normalizeForSearch(o.nativeName).includes(needle)
    || o.code.startsWith(needle))
}
