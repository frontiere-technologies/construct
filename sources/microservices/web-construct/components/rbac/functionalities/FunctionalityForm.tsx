'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import IconPicker from './IconPicker'
import CustomSelect from '../CustomSelect'
import TagInput from './TagInput'
import TranslationsAccordion from './TranslationsAccordion'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import type { CreateNavItemInput } from '@/lib/rbac/types'

// Unified item-type options — idItemType 1 = category, 2 = functionality
const ITEM_TYPES = [
  { key: 'category', label: 'Category',                        idItemType: 1 as const, idFunctionalityType: null },
  { key: 'embedded', label: 'Link esterno embedded (iframe)',   idItemType: 2 as const, idFunctionalityType: 1 },
  { key: 'external', label: 'Link esterno (http[s])',           idItemType: 2 as const, idFunctionalityType: 2 },
  { key: 'internal', label: 'Link interno (/path)',             idItemType: 2 as const, idFunctionalityType: 3 },
]

interface Initial {
  description: string; idItemType: 1 | 2; idFunctionalityType: number | null
  functionalityLink: string; iconPath: string; idItemParent: number | null
  /** Active root id (ROOT_ID=0 or OPERATIONS_ID=-1). Used only in create mode to determine placement when idItemParent is null. */
  idRootParent?: number | null
  translations: Record<string, { name?: string; description?: string }>; tagTranslations: Record<string, string[]>
}

export default function FunctionalityForm(
  { mode, funcId, initial, parents }:
  { mode: 'create' | 'edit'; funcId?: number; initial: Initial; parents: { id: number; name: string }[] },
) {
  const router = useRouter()
  const [f, setF] = useState<Initial>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => setF(prev => ({ ...prev, [k]: v }))

  const selectedTypeKey = f.idItemType === 1
    ? 'category'
    : (ITEM_TYPES.find(t => t.idFunctionalityType === f.idFunctionalityType)?.key ?? 'internal')
  const isFunc = f.idItemType === 2
  const itName = f.translations.IT?.name ?? ''
  const itDesc = f.translations.IT?.description ?? ''
  const valid = itName.trim().length > 0 && itDesc.trim().length > 0 && (!isFunc || (f.idFunctionalityType != null && f.functionalityLink.trim().length > 0))

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      setError(null)
      if (mode === 'edit') {
        if (funcId == null) { setError('ID funzionalità mancante'); return }
        const input: CreateNavItemInput = {
          name: itName, idItemType: f.idItemType,
          idFunctionalityType: isFunc ? f.idFunctionalityType : null,
          functionalityLink: isFunc ? f.functionalityLink : null,
          iconPath: f.iconPath || null, idItemParent: f.idItemParent,
          description: itDesc, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
        }
        await updateNavigationItem(funcId, input)
      } else {
        const input: CreateNavItemInput = {
          name: itName, idItemType: f.idItemType,
          idFunctionalityType: isFunc ? f.idFunctionalityType : null,
          functionalityLink: isFunc ? f.functionalityLink : null,
          iconPath: f.iconPath || null, idItemParent: f.idItemParent,
          idRootParent: f.idRootParent ?? null,
          description: itDesc, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
        }
        await createNavigationItem(input)
      }
      router.push('/functionalities')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il salvataggio. Riprova.')
    } finally { setBusy(false) }
  }

  const itTags = f.tagTranslations.IT ?? []

  return (
    <PageContainer title={`Funzionalità / ${mode === 'create' ? 'Crea' : 'Modifica'}`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Informazioni generali</h2>
          <div className="flex items-start gap-3">
            <IconPicker compact value={f.iconPath} onChange={v => set('iconPath', v)} />
            <div className="flex-1 space-y-3">
              <input value={itName} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, name: e.target.value } })}
                placeholder="Nome funzionalità *" maxLength={100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
              <CustomSelect
                data-testid="select-genitore"
                value={f.idItemParent ?? ''}
                onChange={v => set('idItemParent', v !== '' ? Number(v) : null)}
                options={parents.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Genitore"
                disabled={mode === 'edit'}
                title={mode === 'edit' ? 'Sposta tramite trascinamento nell\'albero' : undefined}
              />
            </div>
          </div>
          <div>
            <textarea value={itDesc} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, description: e.target.value } })}
              placeholder="Descrizione *" maxLength={500} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
            <div className="text-right text-[10px] text-gray-400">{itDesc.length}/500</div>
          </div>
          <TagInput value={itTags} onChange={t => set('tagTranslations', { ...f.tagTranslations, IT: t })} placeholder="Tags (IT)" />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-2">Tipologia</h2>
          <div className="space-y-3">
            <CustomSelect
              data-testid="select-tipologia"
              value={selectedTypeKey}
              onChange={v => {
                const opt = ITEM_TYPES.find(t => t.key === v)
                if (opt) setF(prev => ({ ...prev, idItemType: opt.idItemType, idFunctionalityType: opt.idFunctionalityType }))
              }}
              options={ITEM_TYPES.map(t => ({ value: t.key, label: t.label }))}
            />
            {isFunc && (
              <input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder="Link *"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Gestione traduzioni</h2>
          <TranslationsAccordion
            translations={f.translations} tags={f.tagTranslations}
            onTranslations={t => set('translations', t)} onTags={t => set('tagTranslations', t)} />
        </div>
      </div>

      <div className="pt-4 border-t border-border flex items-center justify-between">
        <div>{error && <p className="text-sm text-red-600">{error}</p>}</div>
        <div className="flex gap-3">
          <button onClick={() => router.push('/functionalities')} className="px-4 py-2 text-sm rounded-lg border border-border">
            Annulla
          </button>
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            Salva
          </button>
        </div>
      </div>
    </PageContainer>
  )
}
