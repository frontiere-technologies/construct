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
        .then(({ elements }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = elements.length < GRID_BLOCK_SIZE ? from + elements.length : undefined
          params.successCallback(elements, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
