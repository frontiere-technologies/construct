'use client'

import React, { useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { saveTranslations } from '@/lib/i18n/translation-actions'
import { MAX_VALUE_LENGTH, type TranslationConflict, type TranslationRowDto } from '@/lib/i18n/types'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

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
          <Button
            data-dialog-initial-focus data-dialog-close onClick={() => onClose(false)}
            variant="ghost" size="icon" aria-label={t('common.actions.close')}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-desc">{t('translation.description')}</label>
            <Textarea id="ed-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} className="min-h-[76px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-ns">{t('translation.namespace')}</label>
              <Input id="ed-ns" value={namespace} onChange={e => setNamespace(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="ed-mod">{t('translation.module')}</label>
              <Input id="ed-mod" value={moduleName} onChange={e => setModuleName(e.target.value)} />
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
                    <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning-muted-foreground">
                      {t('translation.missing')}
                    </span>
                  )}
                </label>
                <Textarea
                  id={`ed-v-${language.code}`}
                  data-testid={`translation-value-${language.code}`}
                  value={values[language.code] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [language.code]: e.target.value }))}
                  rows={2}
                  maxLength={MAX_VALUE_LENGTH}
                  className="min-h-[64px]"
                />
              </div>
            )
          })}
        </div>

        {conflicts && (
          <div role="alert" data-testid="translation-conflict" className="mt-4 rounded-lg border border-warning-border bg-warning-muted p-4 text-sm">
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
            <Button
              variant="outline"
              data-dialog-close
              onClick={() => onClose(true)}
              className="mt-3"
            >
              {t('translation.conflict.reload')}
            </Button>
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-destructive-muted-foreground">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
            {t('translation.actions.discard')}
          </Button>
          <Button variant="outline" data-dialog-close onClick={() => onClose(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </Button>
        </div>
      </aside>
    </AccessibleDialog>
  )
}
