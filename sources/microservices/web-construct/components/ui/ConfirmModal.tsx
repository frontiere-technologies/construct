'use client'

import React, { useId, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'

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
      panelClassName="w-full max-w-md rounded-xl bg-surface-overlay p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-2">{title}</h2>
        <p id={descriptionId} className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button data-dialog-initial-focus onClick={onCancel} className="px-3 py-2 text-sm rounded-lg border border-border">{t('common.actions.cancel')}</button>
          <button
            onClick={confirm} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >{confirmLabel ?? t('common.actions.confirm')}</button>
        </div>
    </AccessibleDialog>
  )
}
