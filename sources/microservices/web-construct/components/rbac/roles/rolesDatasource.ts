'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import type { RolesPage } from '@/lib/rbac/types'
import { buildRolesGridQuery, type RolesGridFilterModel, type RolesGridSortItem } from '@/lib/rbac/roles-grid-query'

export function createRolesDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildRolesGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as RolesGridSortItem[],
        params.filterModel as RolesGridFilterModel,
      )
      fetch('/api/rbac/roles-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<RolesPage>
        })
        .then(({ elements, total }) => {
          const from = query.page * GRID_BLOCK_SIZE
          // Use the exact `total` the API already computed (via COUNT()) instead of a
          // length heuristic: `elements.length < GRID_BLOCK_SIZE` never fires when the row
          // total is an exact multiple of GRID_BLOCK_SIZE, so AG Grid would request one
          // extra (empty) block before realizing it had reached the end.
          const lastRow = from + elements.length >= total ? total : undefined
          params.successCallback(elements, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
