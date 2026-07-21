'use client'

import React, { useState } from 'react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmModal({ title, message, confirmLabel = 'Conferma', onConfirm, onCancel }: ConfirmModalProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try { await onConfirm() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-surface-overlay p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 text-sm rounded-lg border border-border">Annulla</button>
          <button
            onClick={confirm} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
