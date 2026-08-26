import type { GridApi } from 'ag-grid-community'

export function resetGridFilters(
  api: Pick<GridApi, 'setFilterModel'> | null,
  clearUrl: () => void,
): void {
  api?.setFilterModel(null)
  clearUrl()
}
