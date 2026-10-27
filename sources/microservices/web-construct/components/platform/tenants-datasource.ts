'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/grid/DataGrid'
import {
  buildTenantsGridQuery,
  type PlatformTenantRow, type TenantsGridFilterModel, type TenantsGridSortItem,
} from '@/lib/platform/tenants-grid-query'

/** Il collegamento fra la griglia dei tenant e la sua rotta (`POST /api/platform/tenants-grid`). */
export function createTenantsDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildTenantsGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as TenantsGridSortItem[],
        params.filterModel as TenantsGridFilterModel,
      )
      fetch('/api/platform/tenants-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<{ rows: PlatformTenantRow[]; total: number }>
        })
        .then(({ rows, total }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = from + rows.length >= total ? total : undefined
          params.successCallback(rows, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
