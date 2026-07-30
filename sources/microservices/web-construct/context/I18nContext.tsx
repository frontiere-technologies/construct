'use client'

import React, { createContext, useCallback, useContext, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTranslator } from '@/lib/i18n/translator'
import { createFormatters, type Formatters } from '@/lib/i18n/format'
import { setPreferredLanguage } from '@/lib/i18n/user-language-actions'
import type { I18nBundle } from '@/lib/i18n/server'
import type { LanguageDto, TranslateFn } from '@/lib/i18n/types'

interface I18nContextValue {
  t: TranslateFn
  fmt: Formatters
  language: LanguageDto
  languages: LanguageDto[]
  code: string
  locale: string
  setLanguage: (code: string) => void
  switching: boolean
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({ bundle, children }: { bundle: I18nBundle; children: React.ReactNode }) {
  const router = useRouter()
  const [switching, startTransition] = useTransition()

  // Keyed on `bundle` alone. `switching` must NOT be a dependency here: it flips
  // twice per language switch, and rebuilding the translator would throw away
  // its missing-key dedup Set mid-switch and hand every child a fresh `t`/`fmt`
  // identity, invalidating their memos and effects for no reason.
  const dictionary = useMemo(() => ({
    t: createTranslator({
      dict: bundle.dict,
      defaultDict: bundle.defaultDict,
      locale: bundle.language.locale,
      isDev: bundle.isDev,
      // Client-side reporting is console-only and dev-only: a network call per
      // missing key would be exactly the log flood §7.3 forbids.
      onMissing: bundle.isDev ? (key: string) => console.warn(`[i18n] missing translation: ${key}`) : undefined,
    }),
    fmt: createFormatters(bundle.language.locale),
  }), [bundle])

  /**
   * Persist the choice, then re-render the RSC tree. `router.refresh()` keeps
   * client component state — open dialogs, half-filled forms, grid filters and
   * selections all survive the switch (§9.4), which a full navigation or
   * `location.reload()` would destroy.
   */
  const setLanguage = useCallback((code: string) => {
    if (code === bundle.language.code) return
    startTransition(async () => {
      await setPreferredLanguage(code)
      router.refresh()
    })
  }, [bundle.language.code, router, startTransition])

  // Only this thin wrapper re-computes when `switching` flips.
  const value = useMemo<I18nContextValue>(() => ({
    ...dictionary,
    language: bundle.language,
    languages: bundle.languages,
    code: bundle.language.code,
    locale: bundle.language.locale,
    setLanguage,
    switching,
  }), [dictionary, bundle.language, bundle.languages, setLanguage, switching])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}

/**
 * For components that must render even when the provider is the thing that
 * failed — `app/(protected)/error.tsx` above all. An error boundary that throws
 * while rendering its own fallback takes the whole tree down, so it cannot use
 * the throwing hook. Returns null outside a provider; callers fall back to a
 * hardcoded string.
 */
export function useOptionalI18n(): I18nContextValue | null {
  return useContext(I18nContext) ?? null
}

/** Shorthand for the common case — a component that only needs labels. */
export function useT(): TranslateFn {
  return useI18n().t
}
