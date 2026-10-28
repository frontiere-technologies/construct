'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/grid/DataGrid'
import {
  buildAuditGridQuery,
  type AuditGridFilterModel, type AuditGridSortItem, type AuditRow,
} from '@/lib/audit/audit-grid-query'

/**
 * Il collegamento fra la griglia del registro e la sua rotta (`/api/audit/tenant-grid` per il
 * tenant, `/api/platform/audit-grid` per la console). `extra` porta i campi fissi della richiesta
 * (per la scheda del modello, `scope: 'template'`).
 */
export function createAuditDatasource(endpoint: string, extra: Record<string, unknown> = {}): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildAuditGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as AuditGridSortItem[],
        params.filterModel as AuditGridFilterModel,
      )
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...query, ...extra }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
          return res.json() as Promise<{ rows: AuditRow[]; total: number }>
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
