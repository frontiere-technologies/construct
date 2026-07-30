import { FALLBACK_LANGUAGE, type LanguageDto } from './types'
import { matchLanguage, parseAcceptLanguage } from './language-negotiation'

export type LanguageSource = 'session' | 'profile' | 'cookie' | 'browser' | 'default'

export interface ResolveLanguageInput {
  /** Code from the session cookie — set only by an explicit switch. */
  sessionChoice?: string | null
  /** `users.id_language` → code, for an authenticated user. */
  profileCode?: string | null
  /** Code from the persistent cookie — an anonymous visitor's last choice. */
  persistentCookie?: string | null
  /** Raw `Accept-Language` header. */
  acceptLanguage?: string | null
  languages: LanguageDto[]
}

export interface ResolvedLanguage {
  language: LanguageDto
  source: LanguageSource
}

/**
 * A stored code is only usable if it still exists *and* is still active (§6.2).
 *
 * Exported because `server.ts` needs the same test to decide whether an explicit
 * session choice really outranks the profile: a *present but unusable* session
 * cookie must not suppress the profile lookup.
 */
export function findUsableLanguage(code: string | null | undefined, languages: LanguageDto[]): LanguageDto | null {
  if (!code) return null
  const found = languages.find(l => l.code === code.toLowerCase().trim())
  return found?.isActive ? found : null
}

function defaultLanguage(languages: LanguageDto[]): LanguageDto {
  return languages.find(l => l.isDefault && l.isActive)
    ?? languages.find(l => l.isActive)
    ?? languages[0]
    ?? FALLBACK_LANGUAGE
}

/**
 * The §6.1 priority chain. Total: any unusable candidate is skipped and the
 * chain continues, so a deleted, deactivated or malformed stored preference
 * degrades to the default instead of failing the render.
 */
export function resolveActiveLanguage(input: ResolveLanguageInput): ResolvedLanguage {
  const { languages } = input

  const session = findUsableLanguage(input.sessionChoice, languages)
  if (session) return { language: session, source: 'session' }

  const profile = findUsableLanguage(input.profileCode, languages)
  if (profile) return { language: profile, source: 'profile' }

  const cookie = findUsableLanguage(input.persistentCookie, languages)
  if (cookie) return { language: cookie, source: 'cookie' }

  const browser = matchLanguage(parseAcceptLanguage(input.acceptLanguage), languages)
  if (browser) return { language: browser, source: 'browser' }

  return { language: defaultLanguage(languages), source: 'default' }
}
