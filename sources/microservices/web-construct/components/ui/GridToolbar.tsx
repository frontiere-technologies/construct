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

export function GridToolbarResetButton(
  { label, onClearFilters }: { label: string; onClearFilters: () => void },
) {
  return (
    <button type="button" onClick={onClearFilters} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
      {label}
    </button>
  )
}

export default function GridToolbar<T>({ gridApi, columns, onClearFilters, children }: GridToolbarProps<T>) {
  const { t } = useI18n()

  return (
    <div className="mb-3 flex items-center justify-end gap-2">
      <GridToolbarResetButton label={t('common.actions.reset_filters')} onClearFilters={onClearFilters} />
      <ColumnVisibilityToggle gridApi={gridApi} columns={columns} />
      {children}
    </div>
  )
}
