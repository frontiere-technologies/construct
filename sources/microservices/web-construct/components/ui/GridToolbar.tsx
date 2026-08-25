'use client'

import type { ReactNode } from 'react'
import type { GridApi } from 'ag-grid-community'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'
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
  // size="sm": the primary action this toolbar sits next to
  // (RolesTableClient.tsx, LanguagesTableClient.tsx, TranslationsTableClient.tsx
  // all pass size="sm" to their "create" Button) is px-3. Left at the
  // unspecified default (px-4) this secondary was wider than the primary
  // beside it — exactly the imbalance BTN-3 closed, reopened at the call
  // site. FunctionalitiesTreeClient.tsx already pairs sm/sm and is the
  // model. See docs/reviews/2026-08-21-button-inventory.md, BTN-3.
  return (
    <Button variant="outline" size="sm" onClick={onClearFilters}>
      {label}
    </Button>
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
