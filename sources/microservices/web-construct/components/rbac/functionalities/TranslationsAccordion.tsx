'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/rbac/types'
import TagInput from './TagInput'

const LABELS: Record<Locale, string> = {
  EN: 'Inglese', IT: 'Italiano', DE: 'Tedesco', FR: 'Francese', ES: 'Spagnolo', NL: 'Olandese', PT: 'Portoghese', SK: 'Slovacco', RO: 'Rumeno',
}
type Tr = Record<string, { name?: string; description?: string }>
type Tg = Record<string, string[]>

export default function TranslationsAccordion(
  { translations, tags, onTranslations, onTags }: { translations: Tr; tags: Tg; onTranslations: (t: Tr) => void; onTags: (t: Tg) => void },
) {
  const [open, setOpen] = useState<Record<string, boolean>>({ EN: true, IT: true })
  const setField = (loc: string, field: 'name' | 'description', v: string) =>
    onTranslations({ ...translations, [loc]: { ...translations[loc], [field]: v } })

  return (
    <div className="space-y-2">
      {SUPPORTED_LOCALES.map(loc => (
        <div key={loc} className="rounded-lg border border-border">
          <button type="button" onClick={() => setOpen(o => ({ ...o, [loc]: !o[loc] }))} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
            {LABELS[loc]}
            {open[loc] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {open[loc] && (
            <div className="px-3 pb-3 space-y-2">
              <input
                value={translations[loc]?.name ?? ''}
                onChange={e => setField(loc, 'name', e.target.value)}
                placeholder="Nome funzionalità"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent"
              />
              <textarea
                value={translations[loc]?.description ?? ''}
                onChange={e => setField(loc, 'description', e.target.value)}
                placeholder="Descrizione"
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent"
              />
              <TagInput value={tags[loc] ?? []} onChange={t => onTags({ ...tags, [loc]: t })} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
