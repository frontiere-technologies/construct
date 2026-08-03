'use client'

import React, { useId, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { createLanguage, updateLanguage } from '@/lib/i18n/language-actions'
import type { LanguagePageItemDto } from '@/lib/i18n/types'
import AccessibleDialog from '@/components/ui/AccessibleDialog'

interface Props {
  language: LanguagePageItemDto | null
  onClose: (saved: boolean) => void
}

export default function LanguageFormModal({ language, onClose }: Props) {
  const { t } = useI18n()
  const [code, setCode] = useState(language?.code ?? '')
  const [locale, setLocale] = useState(language?.locale ?? '')
  const [name, setName] = useState(language?.name ?? '')
  const [nativeName, setNativeName] = useState(language?.nativeName ?? '')
  const [isActive, setIsActive] = useState(language?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const save = async () => {
    setSaving(true)
    setError(null)
    const input = { code, locale, name, nativeName, isActive }
    const result = language ? await updateLanguage(language.id, input) : await createLanguage(input)
    setSaving(false)
    if (result.error) setError(result.error)
    else onClose(true)
  }

  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={() => onClose(false)}
      busy={saving}
      panelClassName="w-full max-w-md rounded-xl bg-surface-overlay p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-4">
          {language ? t('language.form.edit_title') : t('language.form.create_title')}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="lang-code">{t('language.form.code')}</label>
            <input data-dialog-initial-focus id="lang-code" value={code} onChange={e => setCode(e.target.value)} placeholder="it" className={field} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="lang-locale">{t('language.form.locale')}</label>
            <input id="lang-locale" value={locale} onChange={e => setLocale(e.target.value)} placeholder="it-IT" className={field} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="lang-name">{t('language.form.name')}</label>
            <input id="lang-name" value={name} onChange={e => setName(e.target.value)} placeholder="Italiano" className={field} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="lang-native">{t('language.form.native_name')}</label>
            <input id="lang-native" value={nativeName} onChange={e => setNativeName(e.target.value)} placeholder="Italiano" className={field} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            {t('language.active')}
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button data-dialog-close onClick={() => onClose(false)} className="px-3 py-2 text-sm rounded-lg border border-border">
            {t('common.actions.cancel')}
          </button>
          <button
            onClick={save} disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </button>
        </div>
    </AccessibleDialog>
  )
}
