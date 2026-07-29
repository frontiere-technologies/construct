'use client'

import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry, AllCommunityModule,
  type ColDef, type IDatasource, type GridReadyEvent,
  type FilterChangedEvent, type SortChangedEvent,
} from 'ag-grid-community'
import { appGridTheme, gridLocaleText, columnPinningState } from './dataGridConfig'
import { useI18n } from '@/context/I18nContext'

ModuleRegistry.registerModules([AllCommunityModule])

export const GRID_BLOCK_SIZE = 50

export interface DataGridProps<T> {
  columnDefs: ColDef<T>[]
  datasource: IDatasource
  getRowId: (data: T) => string
  initialFilterModel?: Record<string, unknown>
  initialSortModel?: { colId: string; sort: 'asc' | 'desc' }[]
  onFilterChanged?: (event: FilterChangedEvent<T>) => void
  onSortChanged?: (event: SortChangedEvent<T>) => void
  onRowClicked?: (data: T) => void
  onGridReady?: (event: GridReadyEvent<T>) => void
}

export default function DataGrid<T>({
  columnDefs, datasource, getRowId, initialFilterModel, initialSortModel,
  onFilterChanged, onSortChanged, onRowClicked, onGridReady,
}: DataGridProps<T>) {
  const { t } = useI18n()
  const localeText = useMemo(() => gridLocaleText(t), [t])
  const defaultColDef = useMemo<ColDef<T>>(() => ({
    resizable: true,
    sortable: true,
    filter: false,
  }), [])

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden" style={{ height: 600 }}>
      <AgGridReact<T>
        theme={appGridTheme}
        localeText={localeText}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={GRID_BLOCK_SIZE}
        maxBlocksInCache={10}
        getRowId={params => getRowId(params.data)}
        initialState={{
          filter: initialFilterModel ? { filterModel: initialFilterModel } : undefined,
          sort: initialSortModel ? { sortModel: initialSortModel } : undefined,
          // Restores the `pinned` flags that `initialState` would otherwise wipe --
          // see `columnPinningState`.
          columnPinning: columnPinningState(columnDefs),
        }}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onRowClicked={onRowClicked ? e => {
          const target = e.event?.target as HTMLElement | null
          // Paired with the `data-grid-no-row-click` attribute (see GridRowActionsMenu):
          // AG Grid's row-click listener is native DOM, so a cell's React onClick calling
          // stopPropagation() never reaches it — this .closest() check is the only way to
          // opt a cell (e.g. the actions column) out of row-click navigation.
          if (target?.closest('[data-grid-no-row-click]')) return
          if (e.data) onRowClicked(e.data)
        } : undefined}
        onGridReady={onGridReady}
      />
    </div>
  )
}
