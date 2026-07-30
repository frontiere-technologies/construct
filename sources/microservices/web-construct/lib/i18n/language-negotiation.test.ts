import { describe, it, expect } from 'vitest'
import { parseAcceptLanguage, matchLanguage } from './language-negotiation'
import type { LanguageDto } from './types'

const lang = (id: number, code: string, locale: string, isActive = true, isDefault = false): LanguageDto =>
  ({ id, code, locale, name: code, nativeName: code, isActive, isDefault })

const LANGS = [lang(1, 'it', 'it-IT', true, true), lang(2, 'en', 'en-US'), lang(3, 'fr', 'fr-FR', false)]

describe('parseAcceptLanguage', () => {
  it('returns tags ordered by descending q', () => {
    expect(parseAcceptLanguage('en-GB;q=0.8,it-IT;q=0.9,de;q=0.1')).toEqual(['it-IT', 'en-GB', 'de'])
  })
  it('treats a tag without q as q=1', () => {
    expect(parseAcceptLanguage('fr-FR,it-IT;q=0.9')).toEqual(['fr-FR', 'it-IT'])
  })
  it('drops the wildcard', () => {
    expect(parseAcceptLanguage('*')).toEqual([])
  })
  it('clamps an out-of-range q so it cannot outrank an implicit q=1', () => {
    expect(parseAcceptLanguage('en;q=5,fr')).toEqual(['fr', 'en'])
    expect(parseAcceptLanguage('en;q=-1,fr')).toEqual(['fr', 'en'])
  })
  it('treats an unparseable q as least preferred', () => {
    expect(parseAcceptLanguage('en;q=abc,fr')).toEqual(['fr', 'en'])
  })
  it('returns an empty list for null, undefined or empty input', () => {
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage(undefined)).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
  })
})

describe('matchLanguage', () => {
  it('prefers an exact locale match', () => {
    expect(matchLanguage(['en-US'], LANGS)?.code).toBe('en')
  })
  it('is case-insensitive on the locale', () => {
    expect(matchLanguage(['EN-us'], LANGS)?.code).toBe('en')
  })
  it('falls back to the primary subtag when the region differs (it-CH → it-IT)', () => {
    expect(matchLanguage(['it-CH'], LANGS)?.locale).toBe('it-IT')
  })
  it('honours candidate order: an exact match later in the list still loses to an earlier primary-subtag match', () => {
    expect(matchLanguage(['it-CH', 'en-US'], LANGS)?.code).toBe('it')
  })
  it('ignores inactive languages', () => {
    expect(matchLanguage(['fr-FR'], LANGS)).toBeNull()
  })
  it('returns null when nothing matches', () => {
    expect(matchLanguage(['de-DE'], LANGS)).toBeNull()
    expect(matchLanguage([], LANGS)).toBeNull()
  })
})
