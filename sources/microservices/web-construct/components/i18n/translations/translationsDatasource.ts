'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import type { TranslationsPage } from '@/lib/i18n/types'
import {
  buildTranslationsGridQuery,
  type TranslationsGridFilterModel, type TranslationsGridSortItem,
} from '@/lib/i18n/translations-grid-query'

export function createTranslationsDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildTranslationsGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as TranslationsGridSortItem[],
        params.filterModel as TranslationsGridFilterModel,
      )
      fetch('/api/i18n/translations-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<TranslationsPage>
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
