'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/shared/PageContainer'
import { EditableCombobox } from '@/components/shared/EditableCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/context/I18nContext'
import { createTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { isValidNamespace, isValidTranslationKey, namespaceOf } from '@/lib/i18n/key-format'
import { MAX_VALUE_LENGTH, type TranslationConflict, type TranslationRowDto } from '@/lib/i18n/types'
import { translationsListHref } from '@/lib/i18n/translations-return-url'

export interface TranslationKeyFormProps {
  mode: 'create' | 'edit'
  /** Edit mode only. Loaded server-side; carries the versions the save path compares against. */
  row?: TranslationRowDto
  /** Namespaces already in use, for the suggestions. Never restricts what may be typed. */
  namespaces: string[]
  modules: string[]
  /** The list's query string, restored on Annulla and after Salva. */
  from: string
}

/**
 * Creating and editing a translation key, as a page rather than a panel — the
 * same shape Funzionalità and Ruoli & permessi use for their own main entity.
 * A dialog in this application means a short secondary action (rename, confirm
 * a delete), which this is not.
 *
 * All languages for the key are edited and saved together, in one transaction,
 * each carrying the version it was loaded with so a concurrent edit is refused
 * rather than overwritten.
 */
export function TranslationKeyForm({ mode, row, namespaces, modules, from }: TranslationKeyFormProps) {
  const { t, languages } = useI18n()
  const router = useRouter()

  // `Object.hasOwn` guards the lookup: `row.values` is keyed by DB-sourced
  // language codes, so a plain `row.values[l.code]` risks resolving to an
  // inherited Object.prototype member for a code like `constructor` instead
  // of being treated as "no translation for this language".
  const initialValues = useMemo(
    () => Object.fromEntries(languages.map(l => [
      l.code,
      row && Object.hasOwn(row.values, l.code) ? row.values[l.code].value : '',
    ])),
    [languages, row],
  )

  const [key, setKey] = useState(row?.key ?? '')
  const [namespaceTouched, setNamespaceTouched] = useState(false)
  const [namespace, setNamespace] = useState(row?.namespace ?? '')
  const [moduleName, setModuleName] = useState(row?.module ?? '')
  const [description, setDescription] = useState(row?.description ?? '')
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<TranslationConflict[] | null>(null)
  // Create mode only. Set once the key exists, so a retry after a failed value
  // save does not try to create it again and collide on the unique constraint.
  const [createdId, setCreatedId] = useState<number | null>(null)

  const listHref = translationsListHref(from)

  const dirty =
    description !== (row?.description ?? '') ||
    namespace !== (row?.namespace ?? '') ||
    moduleName !== (row?.module ?? '') ||
    languages.some(l => values[l.code] !== initialValues[l.code])

  // Mirrors `validateKeyInput` in translation-actions.ts, so the button is
  // disabled rather than the action returning a string the admin has to read.
  const metadataValid =
    isValidNamespace(namespace.trim()) &&
    (!moduleName.trim() || isValidNamespace(moduleName.trim())) &&
    (mode === 'edit' || isValidTranslationKey(key.trim()))

  // The one place the two modes genuinely diverge: there is nothing for a new
  // key to be dirty against, while resaving an untouched key only burns a version.
  const canSave = metadataValid && (mode === 'create' || dirty)

  // The namespace follows the key by convention until the admin overrides it.
  const handleKeyChange = (next: string) => {
    setKey(next)
    if (!namespaceTouched) setNamespace(next.includes('.') ? namespaceOf(next) : '')
  }

  const valuePayload = () => languages.map(l => ({
    languageCode: l.code,
    value: values[l.code] ?? '',
    version: row && Object.hasOwn(row.values, l.code) ? row.values[l.code].version : null,
  }))

  const metadata = {
    namespace: namespace.trim(),
    module: moduleName.trim() || null,
    description: description.trim() || null,
  }

  const saveValues = async (keyId: number, keyVersion: number) => {
    const result = await saveTranslations({ keyId, keyVersion, ...metadata, values: valuePayload() })
    if (result.ok) { router.push(listHref); return }
    if ('conflicts' in result) setConflicts(result.conflicts)
    else setError(result.error)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setConflicts(null)
    try {
      if (mode === 'edit') {
        // The edit page always passes a row — it answers `notFound()` when the
        // key does not exist. A thrown invariant rather than a message on
        // screen: this is a wiring bug, not something an admin can act on, and
        // user-facing copy here would need a translation key of its own.
        if (!row) throw new Error('TranslationKeyForm: mode="edit" requires a row')
        await saveValues(row.id, row.version)
        return
      }

      let keyId = createdId
      if (keyId == null) {
        const created = await createTranslationKey({ key: key.trim(), ...metadata })
        if (created.error != null) { setError(created.error); return }
        // `KeyActionResult` is `{ error: string | null; id?: number }`, and the
        // action returns an id whenever `error` is null. Narrowed by an
        // invariant, for the same reason as above.
        if (created.id == null) throw new Error('createTranslationKey returned neither an error nor an id')
        keyId = created.id
        setCreatedId(keyId)
      }
      // Nothing typed: the key alone is a complete result, and this is exactly
      // what the dialog this form replaced produced every time.
      if (!languages.some(l => (values[l.code] ?? '').trim())) { router.push(listHref); return }
      // A brand-new key is at `version` 1 (`not null default 1` in schema.sql).
      await saveValues(keyId, 1)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setValues(initialValues)
    setDescription(row?.description ?? '')
    setNamespace(row?.namespace ?? '')
    setModuleName(row?.module ?? '')
    setError(null)
    setConflicts(null)
  }

  const title = `${t('translation.title')} / ${
    mode === 'create' ? t('translation.form.create_label') : t('common.actions.edit')
  }`

  return (
    <PageContainer title={title} subtitle={t('translation.editor.title')}>
      <div data-testid="translation-editor" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('translation.form.general_info')}
          </h2>

          {/* `htmlFor` only where there is a field to point at: in edit mode the
              key is static text, and a label referencing a missing id is a
              dangling accessible name. */}
          {mode === 'create' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-key">
                {t('translation.key')}
              </label>
              <Input
                id="tk-key" value={key} onChange={e => handleKeyChange(e.target.value)}
                placeholder="common.actions.save"
              />
            </div>
          ) : (
            <div>
              <p className="mb-1 text-sm font-medium text-foreground-secondary">{t('translation.key')}</p>
              {/* Read-only text, not a disabled input: the save path carries no
                  key, so renaming is not something the form could offer. */}
              <p className="font-mono text-sm break-all">{row?.key}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-ns">
                {t('translation.namespace')}
              </label>
              <EditableCombobox
                id="tk-ns" value={namespace} options={namespaces} placeholder="common"
                onChange={next => { setNamespaceTouched(true); setNamespace(next) }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-mod">
                {t('translation.module')} <span className="font-normal text-foreground-faint">{t('common.labels.optional')}</span>
              </label>
              <EditableCombobox id="tk-mod" value={moduleName} onChange={setModuleName} options={modules} placeholder="core" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-desc">
              {t('translation.description')}
            </label>
            <Textarea
              id="tk-desc" value={description} onChange={e => setDescription(e.target.value)}
              rows={2} className="min-h-[76px]"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('translation.value')}
          </h2>
          {/* An open list, not an accordion: a translation has one field per
              language, and collapsing would hide the "missing" chip, which is
              the one thing a translator is scanning for. */}
          <div className="space-y-3">
            {languages.map(language => (
              <div key={language.code}>
                <label
                  className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground-secondary"
                  htmlFor={`tk-v-${language.code}`}
                >
                  {language.nativeName}
                  {!values[language.code] && (
                    <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning-muted-foreground">
                      {t('translation.missing')}
                    </span>
                  )}
                </label>
                <Textarea
                  id={`tk-v-${language.code}`}
                  data-testid={`translation-value-${language.code}`}
                  value={values[language.code] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [language.code]: e.target.value }))}
                  rows={2} maxLength={MAX_VALUE_LENGTH} className="min-h-[64px]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {conflicts && (
        <div role="alert" data-testid="translation-conflict" className="rounded-lg border border-warning-border bg-warning-muted p-4 text-sm">
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
          <Button variant="outline" onClick={() => router.push(listHref)} className="mt-3">
            {t('translation.conflict.reload')}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div>{error && <p role="alert" className="text-sm text-destructive-muted-foreground">{error}</p>}</div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
            {t('translation.actions.discard')}
          </Button>
          <Button variant="outline" onClick={() => router.push(listHref)} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
