'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import type { UserDTO } from '@/lib/rbac/types'
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
      fetch('/api/rbac/users-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<{ users: UserDTO[]; total: number }>
        })
        .then(({ users }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = users.length < GRID_BLOCK_SIZE ? from + users.length : undefined
          params.successCallback(users, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
