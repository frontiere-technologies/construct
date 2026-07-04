'use client'

import React from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onApply: () => void
  onReset: () => void
  children: React.ReactNode
}

export default function FilterDrawer({ open, onClose, onApply, onReset, children }: Props) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-surface-overlay shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Filtri</h2>
          <button
            type="button" onClick={onClose} aria-label="Chiudi filtri"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <button
            type="button" onClick={onReset}
            className="px-3 py-2 text-sm rounded-lg border border-border"
          >
            Reset
          </button>
          <button
            type="button" onClick={onApply} data-testid="filters-apply"
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white"
          >
            Applica
          </button>
        </div>
      </div>
    </>
  )
}
