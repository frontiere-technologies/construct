'use client'

import React, { useId, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'
import { Button } from '@/components/ui/button'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const descriptionId = useId()

  const confirm = async () => {
    setBusy(true)
    try { await onConfirm() }
    finally { setBusy(false) }
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onCancel}
      busy={busy}
      panelClassName="w-full max-w-md rounded-xl bg-popover p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-2">{title}</h2>
        <p id={descriptionId} className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" data-dialog-initial-focus data-dialog-close onClick={onCancel}>{t('common.actions.cancel')}</Button>
          <Button onClick={confirm} disabled={busy}>{confirmLabel ?? t('common.actions.confirm')}</Button>
        </div>
    </AccessibleDialog>
  )
}
