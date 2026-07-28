'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import IconPicker from './IconPicker'
import CustomSelect from '../CustomSelect'
import TagInput from './TagInput'
import TranslationsAccordion from './TranslationsAccordion'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import { isGenitoreLocked, buildGenitoreOptions, genitoreValue } from '@/lib/rbac/genitore-lock'
import { ITEM_TYPES, resolveItemType } from '@/lib/rbac/item-type-options'
import { ITEM_TYPE_FUNCTIONALITY } from '@/lib/rbac/types'
import type { CreateNavItemInput, ParentOption } from '@/lib/rbac/types'

interface Initial {
  description: string; idItemType: 1 | 2; idFunctionalityType: number | null
  functionalityLink: string; iconPath: string; idItemParent: number | null
  /** External links only: open the URL in a new tab (the default) instead of in this one. */
  openInNewTab: boolean
  /** Active root id (ROOT_ID=0 or OPERATIONS_ID=-1). Used only in create mode to determine placement when idItemParent is null. */
  idRootParent?: number | null
  translations: Record<string, { name?: string; description?: string }>; tagTranslations: Record<string, string[]>
}

export default function FunctionalityForm(
  { mode, funcId, initial, parents }:
  { mode: 'create' | 'edit'; funcId?: number; initial: Initial; parents: ParentOption[] },
) {
  const router = useRouter()
  const genitoreLocked = isGenitoreLocked(parents.length)
  const [f, setF] = useState<Initial>(() =>
    mode === 'create' && parents.length === 0 ? { ...initial, idItemParent: null } : initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => setF(prev => ({ ...prev, [k]: v }))

  // null while no tipologia has been picked yet — the dropdown then shows its placeholder
  // instead of a type the item doesn't actually have, and the Link field stays hidden.
  const selectedType = resolveItemType(f.idItemType, f.idFunctionalityType)
  const isFunc = selectedType?.idItemType === ITEM_TYPE_FUNCTIONALITY
  const itName = f.translations.IT?.name ?? ''
  const itDesc = f.translations.IT?.description ?? ''
  const valid = itName.trim().length > 0 && itDesc.trim().length > 0 && selectedType != null
    && (!isFunc || f.functionalityLink.trim().length > 0)

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
          openInNewTab: f.openInNewTab,
          description: itDesc, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
        }
        await updateNavigationItem(funcId, input)
      } else {
        const input: CreateNavItemInput = {
          name: itName, idItemType: f.idItemType,
          idFunctionalityType: isFunc ? f.idFunctionalityType : null,
          functionalityLink: isFunc ? f.functionalityLink : null,
          iconPath: f.iconPath || null, idItemParent: f.idItemParent,
          openInNewTab: f.openInNewTab,
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
                value={genitoreValue(f.idItemParent)}
                onChange={v => set('idItemParent', Number(v))}
                options={buildGenitoreOptions(parents)}
                placeholder="Genitore"
                disabled={genitoreLocked}
                title={
                  !genitoreLocked
                    ? undefined
                    : mode === 'create'
                      ? 'Nessuna categoria disponibile: verrà creato alla radice'
                      : 'Nessuna categoria disponibile come genitore'
                }
              />
            </div>
          </div>
          <div>
            <textarea value={itDesc} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, description: e.target.value } })}
              placeholder="Descrizione *" maxLength={500} rows={3}
              // At least twice a single-line input's height (px-3 py-2 text-sm ≈ 38px)
              className="w-full min-h-[76px] px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
            <div className="text-right text-[10px] text-gray-400">{itDesc.length}/500</div>
          </div>
          <TagInput value={itTags} onChange={t => set('tagTranslations', { ...f.tagTranslations, IT: t })} />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-2">Tipologia</h2>
          <div className="space-y-3">
            <CustomSelect
              data-testid="select-tipologia"
              value={selectedType?.key ?? ''}
              onChange={v => {
                const opt = ITEM_TYPES.find(t => t.key === v)
                if (opt) setF(prev => ({ ...prev, idItemType: opt.idItemType, idFunctionalityType: opt.idFunctionalityType }))
              }}
              options={ITEM_TYPES.map(t => ({ value: t.key, label: t.label }))}
              placeholder="Tipologia *"
            />
            {isFunc && (
              <input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder="Link *"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
            )}
            {selectedType?.key === 'external' && (
              <label className="flex items-center gap-2 text-sm text-foreground-secondary cursor-pointer">
                <input
                  data-testid="check-open-in-new-tab"
                  type="checkbox"
                  checked={f.openInNewTab}
                  onChange={e => set('openInNewTab', e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                Apri in una nuova scheda
              </label>
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
