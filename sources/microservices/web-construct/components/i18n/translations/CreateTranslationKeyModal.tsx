'use client'

import React, { useId, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { createTranslationKey } from '@/lib/i18n/translation-actions'
import { namespaceOf } from '@/lib/i18n/key-format'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export default function CreateTranslationKeyModal({ onClose }: { onClose: (saved: boolean) => void }) {
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const [namespaceTouched, setNamespaceTouched] = useState(false)
  const [namespace, setNamespace] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  // The namespace follows the key by convention until the admin overrides it.
  const handleKeyChange = (next: string) => {
    setKey(next)
    if (!namespaceTouched) setNamespace(next.includes('.') ? namespaceOf(next) : '')
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const result = await createTranslationKey({
      key, namespace, module: moduleName || null, description: description || null,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else onClose(true)
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={() => onClose(false)}
      busy={saving}
      panelClassName="w-full max-w-md rounded-xl bg-popover p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-4">{t('translation.actions.create')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-key">{t('translation.key')}</label>
            <Input data-dialog-initial-focus id="tk-key" value={key} onChange={e => handleKeyChange(e.target.value)} placeholder="common.actions.save" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-ns">{t('translation.namespace')}</label>
            <Input id="tk-ns" value={namespace} onChange={e => { setNamespaceTouched(true); setNamespace(e.target.value) }} placeholder="common" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-mod">
              {t('translation.module')} <span className="font-normal text-foreground-faint">{t('common.labels.optional')}</span>
            </label>
            <Input id="tk-mod" value={moduleName} onChange={e => setModuleName(e.target.value)} placeholder="core" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1" htmlFor="tk-desc">{t('translation.description')}</label>
            <Textarea id="tk-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} className="min-h-[76px]" />
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-destructive-muted-foreground">{error}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" data-dialog-close onClick={() => onClose(false)}>{t('common.actions.cancel')}</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </Button>
        </div>
    </AccessibleDialog>
  )
}
