'use client'

import type { ReactNode } from 'react'
import type { GridApi } from 'ag-grid-community'
import { useI18n } from '@/context/I18nContext'
import ColumnVisibilityToggle, { type ToggleableColumn } from './ColumnVisibilityToggle'

interface GridToolbarProps<T> {
  gridApi: GridApi<T> | null
  columns: ToggleableColumn[]
  onClearFilters: () => void
  children?: ReactNode
}

export default function GridToolbar<T>({ gridApi, columns, onClearFilters, children }: GridToolbarProps<T>) {
  const { t } = useI18n()

  return (
    <div className="mb-3 flex items-center justify-end gap-2">
      <button onClick={onClearFilters} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
        {t('common.actions.reset_filters')}
      </button>
      <ColumnVisibilityToggle gridApi={gridApi} columns={columns} />
      {children}
    </div>
  )
}
