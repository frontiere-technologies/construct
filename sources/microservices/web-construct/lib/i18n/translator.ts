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
/**
 * Read a dictionary entry, or undefined.
 *
 * `Object.hasOwn` plus a `typeof` check, never bare indexing: a dictionary is a
 * plain object, so `dict['toString']` would return an inherited function —
 * truthy, but not a string — and `interpolate` would then throw on `.includes`,
 * breaking the "no throwing path" guarantee for any malformed or dynamically
 * built key. Module-level, because `t()` runs for every label on every render.
 */
function own(d: Dictionary, k: string): string | undefined {
  return Object.hasOwn(d, k) && typeof d[k] === 'string' ? d[k] : undefined
}

export function createTranslator({
  dict, defaultDict, locale, isDev, onMissing,
}: TranslatorOptions): TranslateFn {
  const reported = new Set<string>()

  return function t(key: string, params?: TranslationParams): string {
    const template = own(dict, key) || own(defaultDict, key)
    if (template) return interpolate(template, params, locale)

    if (onMissing && !reported.has(key)) {
      reported.add(key)
      onMissing(key)
    }
    return isDev ? `[missing: ${key}]` : key
  }
}
