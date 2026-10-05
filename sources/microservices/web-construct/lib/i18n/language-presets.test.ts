import { describe, expect, it } from 'vitest'
import { languageInputSchema } from './language-rules'
import {
  LANGUAGE_PRESETS, filterLanguagePresets, languagePresetOptions, normalizeForSearch,
} from './language-presets'

describe('LANGUAGE_PRESETS', () => {
  it('passes the server validation for every entry', () => {
    for (const { code, locale } of LANGUAGE_PRESETS) {
      const parsed = languageInputSchema.safeParse({ code, locale, name: 'x', nativeName: 'x', isActive: true })
      expect(parsed.success, `${code} / ${locale}`).toBe(true)
    }
  })

  it('has unique codes, each the language part of its locale', () => {
    const codes = LANGUAGE_PRESETS.map(p => p.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const { code, locale } of LANGUAGE_PRESETS) expect(locale.split('-')[0]).toBe(code)
  })
})

describe('languagePresetOptions', () => {
  it.each(['it-IT', 'en-US'])('names every preset, both ways, with a %s interface', uiLocale => {
    const options = languagePresetOptions(uiLocale)
    expect(options).toHaveLength(LANGUAGE_PRESETS.length)
    for (const option of options) {
      expect(option.name.trim()).not.toBe('')
      expect(option.nativeName.trim()).not.toBe('')
      expect(option.name).not.toBe(option.code)
    }
  })

  it('names a language in the interface language and in its own, first letter capitalised', () => {
    const italian = languagePresetOptions('it-IT')
    expect(italian.find(o => o.code === 'de')).toEqual({ code: 'de', locale: 'de-DE', name: 'Tedesco', nativeName: 'Deutsch' })
    // The code, not the locale: "Portoghese", not "Portoghese (Portogallo)".
    expect(italian.find(o => o.code === 'pt')?.name).toBe('Portoghese')
    expect(languagePresetOptions('en-US').find(o => o.code === 'de')?.name).toBe('German')
  })

  it('capitalises a native name that its own language writes in lowercase', () => {
    const byCode = new Map(languagePresetOptions('it-IT').map(o => [o.code, o.nativeName]))
    expect(byCode.get('es')).toBe('Español')
    expect(byCode.get('fr')).toBe('Français')
    expect(byCode.get('tr')).toBe('Türkçe')
    expect(byCode.get('it')).toBe('Italiano')
  })

  it('degrades to the code, without throwing, for an unusable interface locale', () => {
    const options = languagePresetOptions('not a locale!!')
    expect(options).toHaveLength(LANGUAGE_PRESETS.length)
    for (const option of options) expect(option.name).toBe(option.code)
    // The native names do not depend on the interface locale.
    expect(options.find(o => o.code === 'de')?.nativeName).toBe('Deutsch')
  })

  it('sorts by the interface-language name', () => {
    const names = languagePresetOptions('it-IT').map(o => o.name)
    const collator = new Intl.Collator('it-IT')
    expect(names).toEqual([...names].sort(collator.compare))
    expect(names[0]).toBe('Arabo')
  })
})

describe('filterLanguagePresets', () => {
  const codesFor = (uiLocale: string, query: string) =>
    filterLanguagePresets(languagePresetOptions(uiLocale), query).map(o => o.code)

  it('matches the name in the current interface language', () => {
    expect(codesFor('it-IT', 'ingle')).toContain('en')
    expect(codesFor('en-US', 'eng')).toContain('en')
    expect(codesFor('en-US', 'ingle')).not.toContain('en')
  })

  it('matches the native name and the code', () => {
    expect(codesFor('it-IT', 'deutsch')).toEqual(['de'])
    expect(codesFor('it-IT', 'deu')).toContain('de')
    expect(codesFor('it-IT', 'de')).toContain('de')
  })

  it('ignores case and accents', () => {
    expect(codesFor('it-IT', 'espan')).toEqual(['es'])
    expect(codesFor('it-IT', 'SPAGN')).toEqual(['es'])
  })

  it('returns everything for an empty query, nothing for a nonsense one', () => {
    expect(codesFor('it-IT', '  ')).toHaveLength(LANGUAGE_PRESETS.length)
    expect(codesFor('it-IT', 'zzzz')).toEqual([])
  })
})

describe('normalizeForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForSearch('  Español ')).toBe('espanol')
    expect(normalizeForSearch('Ελληνικά')).toBe('ελληνικα')
  })
})
