'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import IconUpload from './IconUpload'
import TagInput from './TagInput'
import TranslationsAccordion from './TranslationsAccordion'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import type { CreateNavItemInput } from '@/lib/rbac/types'

const FUNC_TYPES: { id: number; label: string }[] = [
  { id: 1, label: 'Pagina incorporata' }, { id: 2, label: 'Link esterno' },
  { id: 3, label: 'Funzionalità interna' }, { id: 5, label: 'Permesso' }, { id: 4, label: 'Desktop remoto' },
]

interface Initial {
  name: string; description: string; idItemType: 1 | 2; idFunctionalityType: number | null
  functionalityLink: string; iconPath: string; idItemParent: number | null
  translations: Record<string, { name?: string; description?: string }>; tagTranslations: Record<string, string[]>
}

export default function FunctionalityForm(
  { mode, funcId, initial, parents }:
  { mode: 'create' | 'edit'; funcId?: number; initial: Initial; parents: { id: number; name: string }[] },
) {
  const router = useRouter()
  const [f, setF] = useState<Initial>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => setF(prev => ({ ...prev, [k]: v }))

  const isFunc = f.idItemType === 2
  const itName = f.translations.IT?.name ?? ''
  const itDesc = f.translations.IT?.description ?? ''
  const valid = itName.trim().length > 0 && itDesc.trim().length > 0 && (!isFunc || (f.idFunctionalityType != null && f.functionalityLink.trim().length > 0))

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const input: CreateNavItemInput = {
        name: itName, idItemType: f.idItemType,
        idFunctionalityType: isFunc ? f.idFunctionalityType : null,
        functionalityLink: isFunc ? f.functionalityLink : null,
        iconPath: f.iconPath || null, idItemParent: f.idItemParent,
        description: itDesc, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
      }
      if (mode === 'create') await createNavigationItem(input)
      else await updateNavigationItem(funcId!, input)
      router.push('/functionalities')
    } finally { setBusy(false) }
  }

  const itTags = f.tagTranslations.IT ?? []

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Funzionalità / {mode === 'create' ? 'Crea' : 'Modifica'}</h1>
        <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          {mode === 'create' ? 'Crea funzionalità' : 'Salva'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Informazioni generali</h2>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-3">
              <input value={itName} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, name: e.target.value } })}
                placeholder="Nome funzionalità *" maxLength={100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
              <select value={f.idItemParent ?? ''} onChange={e => set('idItemParent', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent">
                <option value="">Genitore</option>
                {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="w-32"><IconUpload value={f.iconPath} onChange={v => set('iconPath', v)} /></div>
          </div>
          <div>
            <textarea value={itDesc} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, description: e.target.value } })}
              placeholder="Descrizione *" maxLength={500} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
            <div className="text-right text-[10px] text-gray-400">{itDesc.length}/500</div>
          </div>
          <TagInput value={itTags} onChange={t => set('tagTranslations', { ...f.tagTranslations, IT: t })} placeholder="Tags (IT)" />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-2">Impostazioni</h2>
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={f.idItemType === 1} onChange={() => set('idItemType', 1)} /> Categoria</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.idItemType === 2} onChange={() => set('idItemType', 2)} /> Funzionalità</label>
          </div>
          {isFunc && (
            <div className="space-y-3">
              <select value={f.idFunctionalityType ?? ''} onChange={e => set('idFunctionalityType', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent">
                <option value="">Tipologia *</option>
                {FUNC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder="Link *"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Gestione traduzioni</h2>
          <TranslationsAccordion
            translations={f.translations} tags={f.tagTranslations}
            onTranslations={t => set('translations', t)} onTags={t => set('tagTranslations', t)} />
        </div>
      </div>
    </div>
  )
}
