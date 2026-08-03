import { describe, expect, it } from 'vitest'
import { defaultNavigationLocale, navigationFallbackChain, resolveNavigationText, toNavigationLocales } from './navigation-locales'
import type { LanguageDto } from '@/lib/i18n/types'

const language = (overrides: Partial<LanguageDto>): LanguageDto => ({
  id: 1,
  code: 'it',
  locale: 'it-IT',
  name: 'Italiano',
  nativeName: 'Italiano',
  isActive: true,
  isDefault: false,
  ...overrides,
})

describe('navigation locale catalog', () => {
  it('normalizes configured languages and preserves inactive authored locales', () => {
    expect(toNavigationLocales([
      language({ id: 1, code: 'it', isDefault: true }),
      language({ id: 2, code: 'de', locale: 'de-DE', name: 'German', nativeName: 'Deutsch', isActive: false }),
    ])).toEqual([
      { code: 'IT', label: 'Italiano', isActive: true, isDefault: true },
      { code: 'DE', label: 'Deutsch', isActive: false, isDefault: false },
    ])
  })

  it('deduplicates fallback keys while preserving active, configured default, and legacy English order', () => {
    expect(navigationFallbackChain('de', 'it')).toEqual(['DE', 'IT', 'EN'])
    expect(navigationFallbackChain('it', 'it')).toEqual(['IT', 'EN'])
    expect(navigationFallbackChain('en', 'it')).toEqual(['EN', 'IT'])
  })

  it('selects the configured default language for required navigation fields', () => {
    expect(defaultNavigationLocale([
      { code: 'IT', label: 'Italiano', isActive: true, isDefault: false },
      { code: 'JA', label: '日本語', isActive: true, isDefault: true },
    ])).toBe('JA')
    expect(defaultNavigationLocale([])).toBe('EN')
  })

  it('resolves content through active, configured default, English, then the database name', () => {
    const translations = {
      IT: { name: 'Amministrazione' },
      EN: { name: 'Administration' },
    }
    expect(resolveNavigationText(translations, 'name', 'de', 'it', 'Admin')).toBe('Amministrazione')
    expect(resolveNavigationText({ EN: { name: 'Administration' } }, 'name', 'de', 'it', 'Admin')).toBe('Administration')
    expect(resolveNavigationText({}, 'name', 'de', 'it', 'Admin')).toBe('Admin')
  })
})
