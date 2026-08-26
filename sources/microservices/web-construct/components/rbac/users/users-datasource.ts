'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/grid/DataGrid'
import type { UserDto } from '@/lib/rbac/types'
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
          return res.json() as Promise<{ users: UserDto[]; total: number }>
        })
        .then(({ users, total }) => {
          const from = query.page * GRID_BLOCK_SIZE
          // Use the exact `total` the API already computed (via COUNT()) instead of a
          // length heuristic: `users.length < GRID_BLOCK_SIZE` never fires when the row
          // total is an exact multiple of GRID_BLOCK_SIZE, so AG Grid would request one
          // extra (empty) block before realizing it had reached the end.
          const lastRow = from + users.length >= total ? total : undefined
          params.successCallback(users, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
