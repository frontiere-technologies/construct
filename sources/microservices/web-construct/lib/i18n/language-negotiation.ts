import type { LanguageDto } from './types'

/** `Accept-Language` tags, most-preferred first, wildcards dropped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map(part => {
      const [tag, ...rest] = part.trim().split(';')
      const q = rest.map(p => p.trim()).find(p => p.startsWith('q='))
      const weight = q ? Number.parseFloat(q.slice(2)) : 1
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0 }
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
