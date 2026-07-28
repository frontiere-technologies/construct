import type { LanguageDto } from './types'

/** `Accept-Language` tags, most-preferred first, wildcards dropped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map(part => {
      const [tag, ...rest] = part.trim().split(';')
      const q = rest.map(p => p.trim()).find(p => p.startsWith('q='))
      const parsed = q ? Number.parseFloat(q.slice(2)) : 1
      // RFC 9110's qvalue grammar only allows [0, 1]; parseFloat happily accepts
      // `q=5` or `q=-1`, which would otherwise let an out-of-range value outrank
      // (or wrongly lose to) a tag with an implicit q=1. Treat anything outside
      // the valid range the same as an unparseable q: least preferred.
      const weight = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0
      return { tag: tag.trim(), weight }
    })
    .filter(e => e.tag && e.tag !== '*')
    .sort((a, b) => b.weight - a.weight)
    .map(e => e.tag)
}

/**
 * §6.3: for each candidate in preference order try an exact locale match first,
 * then the primary subtag (`it-CH` → the supported `it-IT`). Only active
 * languages are eligible; the caller applies the default when this returns null.
 */
export function matchLanguage(candidates: string[], languages: LanguageDto[]): LanguageDto | null {
  const active = languages.filter(l => l.isActive)
  for (const candidate of candidates) {
    const tag = candidate.toLowerCase()
    const exact = active.find(l => l.locale.toLowerCase() === tag)
    if (exact) return exact
    const primary = tag.split('-')[0]
    const byCode = active.find(l => l.code.toLowerCase() === primary)
    if (byCode) return byCode
  }
  return null
}
