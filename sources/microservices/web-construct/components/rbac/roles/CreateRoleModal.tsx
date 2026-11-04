'use client'

import React, { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/lib/rbac/roles-actions'
import { useI18n } from '@/context/I18nContext'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function CreateRoleModal({ onClose, onRefresh }: { onClose: () => void; onRefresh: () => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const hasLostCapability = errorKey === 'tenant.creation.capability_unavailable'
  const titleId = useId()
  const descriptionId = useId()

  const submit = async () => {
    if (busy || hasLostCapability || !name.trim()) return
    setBusy(true)
    setErrorKey(null)
    try {
      const result = await createRole(name)
      if ('reason' in result) {
        if (result.reason === 'capability_unavailable') {
          setErrorKey('tenant.creation.capability_unavailable')
          return
        }
        setErrorKey('roles.form.quota')
        router.refresh()
        onRefresh()
        return
      }
      router.push(`/roles-permissions/${result.id}`)
    } catch {
      setErrorKey('roles.form.create_error')
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onClose}
      busy={busy}
      panelClassName="w-full max-w-md rounded-xl bg-popover p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-2">{t('roles.form.create_title')}</h2>
        <p id={descriptionId} className="text-sm text-muted-foreground mb-4">{t('roles.form.create_subtitle')}</p>
        <Input
          data-dialog-initial-focus value={name} onChange={e => { setName(e.target.value); setErrorKey(null) }} placeholder={t('roles.form.name')}
          className="mb-6" disabled={hasLostCapability}
        />
        {errorKey && <p role="alert" className="mb-4 text-sm text-destructive-muted-foreground">{t(errorKey)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
          {hasLostCapability && <Button variant="outline" onClick={() => window.location.reload()}>{t('platform.policy.reload')}</Button>}
          <Button onClick={submit} disabled={!name.trim() || busy || hasLostCapability}>{t('common.actions.save')}</Button>
        </div>
    </AccessibleDialog>
  )
}
