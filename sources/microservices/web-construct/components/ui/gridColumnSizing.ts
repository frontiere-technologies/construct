import type { ColDef } from 'ag-grid-community'

export const GRID_MIN_COLUMN_WIDTH = 20

export function normalizeGridColumnDefs<T>(columnDefs: ColDef<T>[]): ColDef<T>[] {
  return columnDefs.map(column => column.colId === 'actions'
    ? column
    : { ...column, resizable: true, minWidth: GRID_MIN_COLUMN_WIDTH })
}
