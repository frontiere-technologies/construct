import type { LanguageDto } from '@/lib/i18n/types'
import type { ItemTranslation } from './types'

export interface NavigationLocale {
  code: string
  label: string
  isActive: boolean
  isDefault: boolean
}

export function normalizeNavigationLocale(code: string): string {
  return code.trim().toUpperCase()
}

export function toNavigationLocales(languages: LanguageDto[]): NavigationLocale[] {
  const seen = new Set<string>()
  const locales: NavigationLocale[] = []
  for (const language of languages) {
    const code = normalizeNavigationLocale(language.code)
    if (!code || seen.has(code)) continue
    seen.add(code)
    locales.push({
      code,
      label: language.nativeName || language.name || code,
      isActive: language.isActive,
      isDefault: language.isDefault,
    })
  }
  return locales
}

export function navigationFallbackChain(activeCode: string, defaultCode: string): string[] {
  return Array.from(new Set([
    normalizeNavigationLocale(activeCode),
    normalizeNavigationLocale(defaultCode),
    'EN',
  ].filter(Boolean)))
}

export function defaultNavigationLocale(locales: NavigationLocale[]): string {
  return locales.find(locale => locale.isDefault)?.code ?? 'EN'
}

export function resolveNavigationText(
  translations: Record<string, ItemTranslation> | null | undefined,
  field: keyof ItemTranslation,
  activeCode: string,
  defaultCode: string,
  baseValue: string | null | undefined,
): string {
  for (const code of navigationFallbackChain(activeCode, defaultCode)) {
    const value = translations?.[code]?.[field]
    if (value) return value
  }
  return baseValue ?? ''
}
