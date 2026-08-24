'use client'

import React, { useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { saveTranslations } from '@/lib/i18n/translation-actions'
import { MAX_VALUE_LENGTH, type TranslationConflict, type TranslationRowDto } from '@/lib/i18n/types'
import AccessibleDialog from '@/components/ui/AccessibleDialog'

interface Props {
  row: TranslationRowDto
  onClose: (saved: boolean) => void
}

/**
 * Side panel rather than in-grid editing: with one column per language the grid
 * is already at its width budget, and §4.4 explicitly allows a drawer once it is.
 * All languages for the key are edited and saved together, in one transaction.
 */
export default function TranslationEditorDrawer({ row, onClose }: Props) {
  const { t, languages } = useI18n()

  // `Object.hasOwn` guards the lookup: `row.values` is keyed by DB-sourced
  // language codes, so a plain `row.values[l.code]` risks resolving to an
  // inherited Object.prototype member for a code like `constructor` instead
  // of being treated as "no translation for this language".
  const initialValues = useMemo(
    () => Object.fromEntries(languages.map(l => [
      l.code,
      Object.hasOwn(row.values, l.code) ? row.values[l.code].value : '',
    ])),
    [languages, row],
  )
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [description, setDescription] = useState(row.description ?? '')
  const [namespace, setNamespace] = useState(row.namespace)
  const [moduleName, setModuleName] = useState(row.module ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<TranslationConflict[] | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const dirty =
    description !== (row.description ?? '') ||
    namespace !== row.namespace ||
    moduleName !== (row.module ?? '') ||
    languages.some(l => values[l.code] !== initialValues[l.code])

  const save = async () => {
    setSaving(true)
    setError(null)
    setConflicts(null)
    const result = await saveTranslations({
      keyId: row.id,
      keyVersion: row.version,
      description: description || null,
      namespace,
      module: moduleName || null,
      values: languages.map(l => ({
        languageCode: l.code,
        value: values[l.code] ?? '',
        version: Object.hasOwn(row.values, l.code) ? row.values[l.code].version : null,
      })),
    })
    setSaving(false)
    if (result.ok) { onClose(true); return }
    if ('conflicts' in result) setConflicts(result.conflicts)
    else setError(result.error)
  }

  const discard = () => {
    setValues(initialValues)
    setDescription(row.description ?? '')
    setNamespace(row.namespace)
    setModuleName(row.module ?? '')
    setError(null)
    setConflicts(null)
  }

  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-popover text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'

  return (
    <AccessibleDialog
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={() => onClose(false)}
      busy={saving}
      align="right"
      panelClassName="h-full w-full max-w-xl overflow-y-auto bg-popover p-6 shadow-xl"
    >
      <aside
        data-testid="translation-editor"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-bold">{row.key}</h2>
            <p id={descriptionId} className="text-sm text-muted-foreground">{t('translation.editor.title')}</p>
          </div>
          <button data-dialog-initial-focus data-dialog-close onClick={() => onClose(false)} aria-label={t('common.actions.close')} className="rounded p-1 hover:bg-accent">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-desc">{t('translation.description')}</label>
            <textarea id="ed-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${field} min-h-[76px]`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-ns">{t('translation.namespace')}</label>
              <input id="ed-ns" value={namespace} onChange={e => setNamespace(e.target.value)} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-mod">{t('translation.module')}</label>
              <input id="ed-mod" value={moduleName} onChange={e => setModuleName(e.target.value)} className={field} />
            </div>
          </div>
        </div>

        <h3 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('translation.value')}
        </h3>
        <div className="space-y-3">
          {languages.map(language => {
            const missing = !values[language.code]
            return (
              <div key={language.code}>
                <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground-secondary" htmlFor={`ed-v-${language.code}`}>
                  {language.nativeName}
                  {missing && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      {t('translation.missing')}
                    </span>
                  )}
                </label>
                <textarea
                  id={`ed-v-${language.code}`}
                  data-testid={`translation-value-${language.code}`}
                  value={values[language.code] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [language.code]: e.target.value }))}
                  rows={2}
                  maxLength={MAX_VALUE_LENGTH}
                  className={`${field} min-h-[64px]`}
                />
              </div>
            )
          })}
        </div>

        {conflicts && (
          <div role="alert" data-testid="translation-conflict" className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm dark:bg-amber-900/20">
            <p className="mb-2 font-semibold">{t('translation.conflict.title')}</p>
            <p className="mb-3 text-foreground-secondary">{t('translation.conflict.explanation')}</p>
            <ul className="space-y-2">
              {conflicts.map(conflict => (
                <li key={conflict.languageCode}>
                  <p className="font-medium">{conflict.languageCode}</p>
                  <p><span className="text-muted-foreground">{t('translation.conflict.current')}:</span> {conflict.currentValue || '—'}</p>
                  <p><span className="text-muted-foreground">{t('translation.conflict.yours')}:</span> {conflict.attemptedValue || '—'}</p>
                </li>
              ))}
            </ul>
            <button
              data-dialog-close
              onClick={() => onClose(true)}
              className="mt-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              {t('translation.conflict.reload')}
            </button>
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={discard} disabled={!dirty || saving} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">
            {t('translation.actions.discard')}
          </button>
          <button data-dialog-close onClick={() => onClose(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
            {t('common.actions.cancel')}
          </button>
          <button onClick={save} disabled={saving || !dirty} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </button>
        </div>
      </aside>
    </AccessibleDialog>
  )
}
