'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import { fetchRolesGridPage } from '@/lib/rbac/roles-actions'
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
      fetchRolesGridPage(query)
        .then(({ elements }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = elements.length < GRID_BLOCK_SIZE ? from + elements.length : undefined
          params.successCallback(elements, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
