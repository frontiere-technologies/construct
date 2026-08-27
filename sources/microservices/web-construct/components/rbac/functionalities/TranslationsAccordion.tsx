'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import type { NavigationLocale } from '@/lib/rbac/navigation-locales'
import TagInput from './TagInput'

type Tr = Record<string, { name?: string; description?: string }>
type Tg = Record<string, string[]>

export default function TranslationsAccordion(
  { locales, translations, tags, onTranslations, onTags }: {
    locales: NavigationLocale[]
    translations: Tr
    tags: Tg
    onTranslations: (t: Tr) => void
    onTags: (t: Tg) => void
  },
) {
  const { t } = useI18n()
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(
    locales.filter(locale => locale.isDefault || locale.code === 'EN').map(locale => [locale.code, true]),
  ))
  const setField = (loc: string, field: 'name' | 'description', v: string) =>
    onTranslations({ ...translations, [loc]: { ...translations[loc], [field]: v } })

  return (
    <div className="space-y-2">
      {locales.map(locale => (
        <div key={locale.code} className="rounded-lg border border-border">
          <button type="button" onClick={() => setOpen(o => ({ ...o, [locale.code]: !o[locale.code] }))} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
            {locale.label}
            {open[locale.code] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {open[locale.code] && (
            <div className="px-3 pb-3 space-y-2">
              <input
                value={translations[locale.code]?.name ?? ''}
                onChange={e => setField(locale.code, 'name', e.target.value)}
                placeholder={t('functionalities.form.name_placeholder_optional')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent"
              />
              <textarea
                value={translations[locale.code]?.description ?? ''}
                onChange={e => setField(locale.code, 'description', e.target.value)}
                placeholder={t('functionalities.form.description_placeholder_optional')}
                rows={2}
                // At least twice a single-line input's height (px-3 py-2 text-sm ≈ 38px)
                className="w-full min-h-[76px] px-3 py-2 text-sm rounded-lg border border-border bg-transparent"
              />
              <TagInput value={tags[locale.code] ?? []} onChange={locTags => onTags({ ...tags, [locale.code]: locTags })} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
