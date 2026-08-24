'use client'

import React, { useId } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'

interface Props {
  open: boolean
  onClose: () => void
  onApply: () => void
  onReset: () => void
  children: React.ReactNode
}

export default function FilterDrawer({ open, onClose, onApply, onReset, children }: Props) {
  const { t } = useI18n()
  const titleId = useId()
  if (!open) return null

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={onClose}
      align="right"
      panelClassName="h-full w-full max-w-sm bg-popover shadow-xl flex flex-col"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 id={titleId} className="text-lg font-semibold">{t('common.labels.filters')}</h2>
          <button
            type="button" onClick={onClose} aria-label={t('common.actions.close_filters')}
            data-dialog-initial-focus
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
            {t('common.actions.reset')}
          </button>
          <button
            type="button" onClick={onApply} data-testid="filters-apply"
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white"
          >
            {t('common.actions.apply')}
          </button>
        </div>
    </AccessibleDialog>
  )
}
