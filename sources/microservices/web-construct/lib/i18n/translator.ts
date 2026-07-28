import { interpolate } from './interpolate'
import type { Dictionary, TranslateFn, TranslationParams } from './types'

export interface TranslatorOptions {
  /** The active language's dictionary. */
  dict: Dictionary
  /** The default language's dictionary, used when `dict` has no value. */
  defaultDict: Dictionary
  /** BCP-47 tag driving number/date formatting of interpolated parameters. */
  locale: string
  /** Development builds surface `[missing: key]`; production degrades to the key. */
  isDev: boolean
  /** Called at most once per key per translator instance (§7.3: no log floods). */
  onMissing?: (key: string) => void
}

/**
 * Build the `t()` used everywhere in the UI.
 *
 * Fallback chain (§7.2): active language → default language → `[missing: key]`
 * in dev / the key itself in production. A missing translation must never stop
 * a render, so this function has no throwing path at all.
 */
export function createTranslator({
  dict, defaultDict, locale, isDev, onMissing,
}: TranslatorOptions): TranslateFn {
  const reported = new Set<string>()

  return function t(key: string, params?: TranslationParams): string {
    const template = dict[key] || defaultDict[key]
    if (template) return interpolate(template, params, locale)

    if (onMissing && !reported.has(key)) {
      reported.add(key)
      onMissing(key)
    }
    return isDev ? `[missing: ${key}]` : key
  }
}
