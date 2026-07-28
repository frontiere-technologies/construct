import type { TranslationParams } from './types'

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function render(value: string | number | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return new Intl.NumberFormat(locale, { useGrouping: true }).format(value)
  if (value instanceof Date) {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
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
    name in params ? render(params[name], locale) : match,
  )
}
