'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import { fetchUsersGridPage } from '@/lib/rbac/users-actions'
import { buildUsersGridQuery, type UsersGridFilterModel, type UsersGridSortItem } from '@/lib/rbac/users-grid-query'

export function createUsersDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildUsersGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as UsersGridSortItem[],
        params.filterModel as UsersGridFilterModel,
      )
      fetchUsersGridPage(query)
        .then(({ users }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = users.length < GRID_BLOCK_SIZE ? from + users.length : undefined
          params.successCallback(users, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
