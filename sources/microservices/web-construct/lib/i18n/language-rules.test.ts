import { describe, it, expect } from 'vitest'
import {
  languageInputSchema, assertCanDeactivate, assertCanDelete, assertCanSetDefault,
} from './language-rules'

const row = (over: Partial<{ isDefault: boolean; isActive: boolean; usageCount: number }> = {}) =>
  ({ isDefault: false, isActive: true, usageCount: 0, ...over })

describe('languageInputSchema', () => {
  it('accepts a well-formed language', () => {
    const r = languageInputSchema.safeParse({ code: 'fr', locale: 'fr-FR', name: 'French', nativeName: 'Français', isActive: true })
    expect(r.success).toBe(true)
  })
  it('lowercases and trims the code', () => {
    const r = languageInputSchema.parse({ code: ' FR ', locale: 'fr-FR', name: 'French', nativeName: 'Français', isActive: true })
    expect(r.code).toBe('fr')
  })
  it('rejects a code that is not 2-3 letters', () => {
    expect(languageInputSchema.safeParse({ code: 'f', locale: 'fr-FR', name: 'x', nativeName: 'x', isActive: true }).success).toBe(false)
    expect(languageInputSchema.safeParse({ code: 'fran', locale: 'fr-FR', name: 'x', nativeName: 'x', isActive: true }).success).toBe(false)
    expect(languageInputSchema.safeParse({ code: 'f1', locale: 'fr-FR', name: 'x', nativeName: 'x', isActive: true }).success).toBe(false)
  })
  it('rejects a locale that is not ll-CC', () => {
    for (const locale of ['fr', 'fr_FR', 'fr-fr', 'FR-FR', 'fr-FRA']) {
      expect(languageInputSchema.safeParse({ code: 'fr', locale, name: 'x', nativeName: 'x', isActive: true }).success).toBe(false)
    }
  })
  it('rejects an empty name or native name', () => {
    expect(languageInputSchema.safeParse({ code: 'fr', locale: 'fr-FR', name: '', nativeName: 'x', isActive: true }).success).toBe(false)
    expect(languageInputSchema.safeParse({ code: 'fr', locale: 'fr-FR', name: 'x', nativeName: '  ', isActive: true }).success).toBe(false)
  })
})

describe('assertCanDeactivate', () => {
  it('allows deactivating a non-default language', () => {
    expect(() => assertCanDeactivate(row())).not.toThrow()
  })
  it('refuses to deactivate the default language', () => {
    expect(() => assertCanDeactivate(row({ isDefault: true }))).toThrow(/predefinita/i)
  })
})

describe('assertCanDelete', () => {
  it('allows deleting an unused non-default language', () => {
    expect(() => assertCanDelete(row())).not.toThrow()
  })
  it('refuses to delete the default language', () => {
    expect(() => assertCanDelete(row({ isDefault: true }))).toThrow(/predefinita/i)
  })
  it('allows deleting a language that still has translations — they cascade', () => {
    expect(() => assertCanDelete(row({ usageCount: 42 }))).not.toThrow()
  })
})

describe('assertCanSetDefault', () => {
  it('allows promoting an active language', () => {
    expect(() => assertCanSetDefault(row())).not.toThrow()
  })
  it('refuses to promote an inactive language', () => {
    expect(() => assertCanSetDefault(row({ isActive: false }))).toThrow(/attiva/i)
  })
})
