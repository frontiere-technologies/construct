import type { TranslationParams } from './types'

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function render(value: string | number | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return new Intl.NumberFormat(locale).format(value)
  // Same explicit field widths as format.ts's `dateFmt`, so a date renders
  // identically whether it arrives as a t() parameter or through fmt.date().
  if (value instanceof Date) {
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value)
  }
  return value
}

/**
 * Replace every `{{param}}` in `template` with its value.
 *
 * Single-pass by construction: `String.replace` with a global regex scans the
 * *original* string, so a substituted value containing `{{other}}` is never
 * re-scanned. That is a security property, not an optimisation — an admin-edited
 * translation must not be able to reach a second parameter through its own value.
 *
 * An unknown placeholder is left in place rather than blanked: a visible
 * `{{name}}` is a bug report, a silent empty string is a wrong label.
 */
export function interpolate(
  template: string,
  params: TranslationParams | undefined,
  locale: string,
): string {
  if (!params || !template.includes('{{')) return template
  return template.replace(PLACEHOLDER_RE, (match, name: string) =>
    // `Object.hasOwn`, never `name in params`: `in` walks the prototype chain,
    // so `{{toString}}` against an empty params object would resolve to
    // Object.prototype.toString and render "function toString() { … }" instead
    // of being left alone as an unknown placeholder.
    Object.hasOwn(params, name) ? render(params[name], locale) : match,
  )
}
