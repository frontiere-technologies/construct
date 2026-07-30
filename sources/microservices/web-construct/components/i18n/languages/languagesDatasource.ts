'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import type { LanguagesPage } from '@/lib/i18n/types'
import {
  buildLanguagesGridQuery,
  type LanguagesGridFilterModel, type LanguagesGridSortItem,
} from '@/lib/i18n/languages-grid-query'

export function createLanguagesDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildLanguagesGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as LanguagesGridSortItem[],
        params.filterModel as LanguagesGridFilterModel,
      )
      fetch('/api/i18n/languages-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<LanguagesPage>
        })
        .then(({ elements, total }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = from + elements.length >= total ? total : undefined
          params.successCallback(elements, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
