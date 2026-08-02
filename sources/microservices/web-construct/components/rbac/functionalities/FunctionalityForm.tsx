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
import { useI18n } from '@/context/I18nContext'
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
  const { t } = useI18n()
  const router = useRouter()
  const genitoreLocked = isGenitoreLocked(parents.length)
  const itemTypeLabels: Record<string, string> = {
    category: t('functionalities.item_type.category'),
    embedded: t('functionalities.item_type.embedded'),
    external: t('functionalities.item_type.external'),
    internal: t('functionalities.item_type.internal'),
  }
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
        if (funcId == null) { setError(t('functionalities.form.missing_id_error')); return }
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
      setError(err instanceof Error ? err.message : t('functionalities.form.save_error'))
    } finally { setBusy(false) }
  }

  const itTags = f.tagTranslations.IT ?? []

  return (
    <PageContainer title={`${t('functionalities.list.title')} / ${mode === 'create' ? t('functionalities.form.create_label') : t('common.actions.edit')}`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('functionalities.form.general_info')}</h2>
          <div className="flex items-start gap-3">
            <IconPicker compact value={f.iconPath} onChange={v => set('iconPath', v)} />
            <div className="flex-1 space-y-3">
              <input value={itName} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, name: e.target.value } })}
                placeholder={t('functionalities.form.name_placeholder')} maxLength={100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
              <CustomSelect
                data-testid="select-genitore"
                ariaLabel={t('functionalities.form.parent_placeholder')}
                value={genitoreValue(f.idItemParent)}
                onChange={v => set('idItemParent', Number(v))}
                options={buildGenitoreOptions(parents)}
                placeholder={t('functionalities.form.parent_placeholder')}
                disabled={genitoreLocked}
                title={
                  !genitoreLocked
                    ? undefined
                    : mode === 'create'
                      ? t('functionalities.form.parent_locked_create_hint')
                      : t('functionalities.form.parent_locked_edit_hint')
                }
              />
            </div>
          </div>
          <div>
            <textarea value={itDesc} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, description: e.target.value } })}
              placeholder={t('functionalities.form.description_placeholder')} maxLength={500} rows={3}
              // At least twice a single-line input's height (px-3 py-2 text-sm ≈ 38px)
              className="w-full min-h-[76px] px-3 py-2 text-sm rounded-lg border border-border bg-transparent" />
            <div className="text-right text-[10px] text-gray-400">{itDesc.length}/500</div>
          </div>
          <TagInput value={itTags} onChange={newTags => set('tagTranslations', { ...f.tagTranslations, IT: newTags })} />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-2">{t('functionalities.form.type_heading')}</h2>
          <div className="space-y-3">
            <CustomSelect
              data-testid="select-tipologia"
              ariaLabel={t('functionalities.form.type_heading')}
              value={selectedType?.key ?? ''}
              onChange={v => {
                const opt = ITEM_TYPES.find(candidate => candidate.key === v)
                if (opt) setF(prev => ({ ...prev, idItemType: opt.idItemType, idFunctionalityType: opt.idFunctionalityType }))
              }}
              options={ITEM_TYPES.map(opt => ({ value: opt.key, label: itemTypeLabels[opt.key] ?? opt.label }))}
              placeholder={t('functionalities.form.type_placeholder')}
            />
            {isFunc && (
              <input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder={t('functionalities.form.link_placeholder')}
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
                {t('functionalities.form.open_new_tab')}
              </label>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{t('functionalities.form.translations_heading')}</h2>
          <TranslationsAccordion
            translations={f.translations} tags={f.tagTranslations}
            onTranslations={newTranslations => set('translations', newTranslations)} onTags={newTags => set('tagTranslations', newTags)} />
        </div>
      </div>

      <div className="pt-4 border-t border-border flex items-center justify-between">
        <div>{error && <p className="text-sm text-red-600">{error}</p>}</div>
        <div className="flex gap-3">
          <button onClick={() => router.push('/functionalities')} className="px-4 py-2 text-sm rounded-lg border border-border">
            {t('common.actions.cancel')}
          </button>
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {t('common.actions.save')}
          </button>
        </div>
      </div>
    </PageContainer>
  )
}
