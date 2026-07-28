import { describe, it, expect } from 'vitest'
import { resolveActiveLanguage } from './resolve-language'
import type { LanguageDto } from './types'

const lang = (id: number, code: string, locale: string, isActive = true, isDefault = false): LanguageDto =>
  ({ id, code, locale, name: code, nativeName: code, isActive, isDefault })

const IT = lang(1, 'it', 'it-IT', true, true)
const EN = lang(2, 'en', 'en-US')
const FR = lang(3, 'fr', 'fr-FR', false)
const LANGS = [IT, EN, FR]

describe('resolveActiveLanguage', () => {
  it('prefers the language explicitly chosen in this session', () => {
    const r = resolveActiveLanguage({
      sessionChoice: 'en', profileCode: 'it', persistentCookie: 'it',
      acceptLanguage: 'it-IT', languages: LANGS,
    })
    expect(r.language.code).toBe('en')
    expect(r.source).toBe('session')
  })
  it('falls to the authenticated profile when there is no session choice', () => {
    const r = resolveActiveLanguage({ profileCode: 'en', persistentCookie: 'it', acceptLanguage: 'it-IT', languages: LANGS })
    expect(r.language.code).toBe('en')
    expect(r.source).toBe('profile')
  })
  it('falls to the persistent cookie for an anonymous visitor', () => {
    const r = resolveActiveLanguage({ persistentCookie: 'en', acceptLanguage: 'it-IT', languages: LANGS })
    expect(r.language.code).toBe('en')
    expect(r.source).toBe('cookie')
  })
  it('falls to the browser preference when nothing is stored', () => {
    const r = resolveActiveLanguage({ acceptLanguage: 'en-GB;q=0.9', languages: LANGS })
    expect(r.language.code).toBe('en')
    expect(r.source).toBe('browser')
  })
  it('falls to the configured default when nothing else applies', () => {
    const r = resolveActiveLanguage({ languages: LANGS })
    expect(r.language.code).toBe('it')
    expect(r.source).toBe('default')
  })
  it('ignores a stored language that has been deactivated', () => {
    const r = resolveActiveLanguage({ sessionChoice: 'fr', profileCode: 'fr', languages: LANGS })
    expect(r.language.code).toBe('it')
    expect(r.source).toBe('default')
  })
  it('ignores a stored language that no longer exists', () => {
    const r = resolveActiveLanguage({ profileCode: 'de', languages: LANGS })
    expect(r.language.code).toBe('it')
    expect(r.source).toBe('default')
  })
  it('ignores a malformed stored value instead of throwing', () => {
    const r = resolveActiveLanguage({ profileCode: 'not a locale!!', languages: LANGS })
    expect(r.language.code).toBe('it')
  })
  it('skips an unusable profile value but still honours the cookie below it', () => {
    const r = resolveActiveLanguage({ profileCode: 'fr', persistentCookie: 'en', languages: LANGS })
    expect(r.language.code).toBe('en')
    expect(r.source).toBe('cookie')
  })
  it('uses the first active language when no row is flagged default', () => {
    const r = resolveActiveLanguage({ languages: [lang(9, 'de', 'de-DE'), lang(8, 'es', 'es-ES')] })
    expect(r.language.code).toBe('de')
    expect(r.source).toBe('default')
  })
  it('falls back to Italian when the language list is empty rather than throwing', () => {
    const r = resolveActiveLanguage({ languages: [] })
    expect(r.language.code).toBe('it')
    expect(r.source).toBe('default')
  })
})
