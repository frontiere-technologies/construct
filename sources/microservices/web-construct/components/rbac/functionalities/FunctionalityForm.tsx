'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/shared/PageContainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import { isGenitoreLocked, buildGenitoreOptions, genitoreValue, parseGenitoreSelection } from '@/lib/rbac/genitore-lock'
import { ITEM_TYPES, resolveItemType } from '@/lib/rbac/item-type-options'
import { ITEM_TYPE_FUNCTIONALITY } from '@/lib/rbac/types'
import { useI18n } from '@/context/I18nContext'
import type { CreateNavItemInput, ParentOption } from '@/lib/rbac/types'
import { defaultNavigationLocale, type NavigationLocale } from '@/lib/rbac/navigation-locales'
import CustomSelect from '@/components/rbac/CustomSelect'
import TranslationsAccordion from './TranslationsAccordion'
import TagInput from './TagInput'
import IconPicker from './IconPicker'

interface Initial {
  description: string; idItemType: 1 | 2; idFunctionalityType: number | null
  functionalityLink: string; iconPath: string; idItemParent: number | null
  /** External links only: open the URL in a new tab (the default) instead of in this one. */
  openInNewTab: boolean
  translations: Record<string, { name?: string; description?: string }>; tagTranslations: Record<string, string[]>
}

export default function FunctionalityForm(
  { mode, funcId, initial, parents, locales }:
  { mode: 'create' | 'edit'; funcId?: number; initial: Initial; parents: ParentOption[]; locales: NavigationLocale[] },
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

  // Il server (updateNavigationItem) rifiuta un cambio di tipologia categoria <-> funzionalità:
  // un id_functionality_type senza id_permission diventerebbe una voce pubblica e ingovernabile
  // (vedi il commento in navigation-actions.ts). La tendina si blocca qui per lo stesso motivo,
  // non solo perché il server la rifiuterebbe: un campo che accetta una scelta e poi la rifiuta
  // al salvataggio è peggio di uno che non l'accetta affatto.
  const typeLocked = mode === 'edit'

  // null while no tipologia has been picked yet — the dropdown then shows its placeholder
  // instead of a type the item doesn't actually have, and the Link field stays hidden.
  const selectedType = resolveItemType(f.idItemType, f.idFunctionalityType)
  const isFunc = selectedType?.idItemType === ITEM_TYPE_FUNCTIONALITY
  const defaultLocale = defaultNavigationLocale(locales)
  const primaryName = f.translations[defaultLocale]?.name ?? ''
  const primaryDescription = f.translations[defaultLocale]?.description ?? ''
  const valid = primaryName.trim().length > 0 && primaryDescription.trim().length > 0 && selectedType != null
    && (!isFunc || f.functionalityLink.trim().length > 0)

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      setError(null)
      if (mode === 'edit') {
        if (funcId == null) { setError(t('functionalities.form.missing_id_error')); return }
        const input: CreateNavItemInput = {
          name: primaryName, idItemType: f.idItemType,
          idFunctionalityType: isFunc ? f.idFunctionalityType : null,
          functionalityLink: isFunc ? f.functionalityLink : null,
          iconPath: f.iconPath || null, idItemParent: f.idItemParent,
          openInNewTab: f.openInNewTab,
          description: primaryDescription, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
        }
        await updateNavigationItem(funcId, input)
      } else {
        const input: CreateNavItemInput = {
          name: primaryName, idItemType: f.idItemType,
          idFunctionalityType: isFunc ? f.idFunctionalityType : null,
          functionalityLink: isFunc ? f.functionalityLink : null,
          iconPath: f.iconPath || null, idItemParent: f.idItemParent,
          openInNewTab: f.openInNewTab,
          description: primaryDescription, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
        }
        await createNavigationItem(input)
      }
      router.push('/functionalities')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('functionalities.form.save_error'))
    } finally { setBusy(false) }
  }

  const primaryTags = f.tagTranslations[defaultLocale] ?? []

  return (
    <PageContainer title={`${t('functionalities.list.title')} / ${mode === 'create' ? t('functionalities.form.create_label') : t('common.actions.edit')}`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('functionalities.form.general_info')}</h2>
          <div className="flex items-start gap-3">
            <IconPicker compact value={f.iconPath} onChange={v => set('iconPath', v)} />
            <div className="flex-1 space-y-3">
              <Input value={primaryName} onChange={e => set('translations', { ...f.translations, [defaultLocale]: { ...f.translations[defaultLocale], name: e.target.value } })}
                placeholder={t('functionalities.form.name_placeholder')} maxLength={100}
                className="bg-transparent" />
              <CustomSelect
                data-testid="select-genitore"
                ariaLabel={t('functionalities.form.parent_placeholder')}
                value={genitoreValue(f.idItemParent)}
                onChange={v => set('idItemParent', parseGenitoreSelection(Number(v)))}
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
            <Textarea value={primaryDescription} onChange={e => set('translations', { ...f.translations, [defaultLocale]: { ...f.translations[defaultLocale], description: e.target.value } })}
              placeholder={t('functionalities.form.description_placeholder')} maxLength={500} rows={3}
              // At least twice a single-line input's height (px-3 py-2 text-sm ≈ 38px)
              className="min-h-[76px] bg-transparent" />
            <div className="text-right text-[10px] text-muted-foreground">{primaryDescription.length}/500</div>
          </div>
          <TagInput value={primaryTags} onChange={newTags => set('tagTranslations', { ...f.tagTranslations, [defaultLocale]: newTags })} />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">{t('functionalities.form.type_heading')}</h2>
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
              disabled={typeLocked}
              title={typeLocked ? t('functionalities.form.type_locked_edit_hint') : undefined}
            />
            {isFunc && (
              <Input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder={t('functionalities.form.link_placeholder')}
                className="bg-transparent" />
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('functionalities.form.translations_heading')}</h2>
          <TranslationsAccordion
            locales={locales}
            translations={f.translations} tags={f.tagTranslations}
            onTranslations={newTranslations => set('translations', newTranslations)} onTags={newTags => set('tagTranslations', newTags)} />
        </div>
      </div>

      <div className="pt-4 border-t border-border flex items-center justify-between">
        <div>{error && <p className="text-sm text-destructive-muted-foreground">{error}</p>}</div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.push('/functionalities')}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {t('common.actions.save')}
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
