'use client'

import React, { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import { DataGrid } from '@/components/grid/DataGrid'
import { GridToolbar } from '@/components/grid/GridToolbar'
import { DATE_FILTER, TEXT_FILTER } from '@/components/grid/grid-column-filters'
import { resetGridFilters } from '@/components/grid/grid-reset'
import { useGridUrlSync } from '@/components/grid/grid-url-sync'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import { useI18n } from '@/context/I18nContext'
import {
  auditFilterModelToSearchParams, auditOperationKey, auditUrlParamsToFilterModel, auditUrlParamsToSortModel,
  type AuditGridFilterModel, type AuditRow, type AuditUrlParams,
} from '@/lib/audit/audit-grid-query'
import { AUDIT_OPERATIONS } from '@/lib/audit/audit-types'
import { createAuditDatasource } from './audit-datasource'

const AUDIT_TEXT_FILTER = TEXT_FILTER as Pick<ColDef<AuditRow>, 'filter' | 'filterParams'>
const AUDIT_DATE_FILTER = DATE_FILTER as Pick<ColDef<AuditRow>, 'filter' | 'filterParams'>

type Cell = { data?: AuditRow }

interface Props extends AuditUrlParams {
  /** La rotta che serve le righe. */
  endpoint: string
  /** Campi fissi della richiesta, oltre ai filtri (la scheda del modello manda `scope: 'template'`). */
  extraQuery?: Record<string, unknown>
  /** La colonna del tenant toccato: solo nel registro della piattaforma. */
  showTenant?: boolean
  /** Dove tiene filtri e ordine: nell'indirizzo della pagina (default), o solo in memoria quando la griglia sta dentro un'altra pagina. */
  syncUrl?: boolean
}

/**
 * Il registro in una griglia (specifica 2026-10-26, MT5-DEC-16): quando, chi, con quale veste, che
 * operazione, su quale oggetto e i dettagli (già ripuliti dal server). Filtri: periodo, persona,
 * operazione; ordine su quando, persona e operazione. Sola lettura: il registro non si modifica.
 */
export function AuditTableClient(props: Props) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [gridApi, setGridApi] = useState<GridApi<AuditRow> | null>(null)
  const gridApiRef = useRef<GridApi<AuditRow> | null>(null)
  const syncUrl = props.syncUrl ?? true

  const gridUrlSync = useGridUrlSync(pathname, sp.toString(), url => router.replace(url))
  const setParam = (updates: Record<string, string | null>) => { if (syncUrl) gridUrlSync.update(updates) }
  // La richiesta fissa arriva da una pagina del server: si confronta per contenuto, non per identità.
  const extraKey = JSON.stringify(props.extraQuery ?? {})
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `extraKey` è il contenuto di `props.extraQuery`
  const datasource = useMemo(() => createAuditDatasource(props.endpoint, props.extraQuery), [props.endpoint, extraKey])

  const columnDefs = useMemo<ColDef<AuditRow>[]>(() => [
    {
      colId: 'occurredAt', field: 'occurredAt', headerName: t('audit.col.time'), sortable: true, ...AUDIT_DATE_FILTER,
      valueGetter: p => p.data ? fmt.dateTime(p.data.occurredAt) : '',
    },
    {
      colId: 'actor', field: 'actorEmail', headerName: t('audit.col.actor'), sortable: true, ...AUDIT_TEXT_FILTER,
      valueGetter: p => p.data ? (p.data.actorEmail ?? '—') : '',
    },
    {
      colId: 'kind', field: 'actorKind', headerName: t('audit.col.kind'), sortable: false,
      valueGetter: p => p.data ? t(`audit.kind.${p.data.actorKind}`) : '',
    },
    {
      colId: 'operation', field: 'operation', headerName: t('audit.col.operation'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: AUDIT_OPERATIONS.map(value => ({ value, label: t(auditOperationKey(value)) })) },
      valueGetter: p => p.data ? t(auditOperationKey(p.data.operation)) : '',
    },
    {
      colId: 'object', headerName: t('audit.col.object'), sortable: false,
      valueGetter: p => p.data ? [p.data.objectType, p.data.objectId].filter(Boolean).join(' ') : '',
    },
    ...(props.showTenant ? [{
      colId: 'tenant', headerName: t('audit.col.tenant'), sortable: false,
      cellRenderer: ({ data }: Cell) => data?.tenantId != null ? (
        <Link href={`/platform/tenants/${data.tenantId}`} data-grid-no-row-click className="text-primary underline-offset-4 hover:underline">
          {data.tenantName ?? data.tenantId}
        </Link>
      ) : null,
    } satisfies ColDef<AuditRow>] : []),
    {
      colId: 'details', headerName: t('audit.col.details'), sortable: false, flex: 1, minWidth: 240,
      cellRenderer: ({ data }: Cell) => {
        if (!data) return null
        const compact = JSON.stringify(data.details)
        if (compact === '{}') return null
        return <code title={JSON.stringify(data.details, null, 2)} className="truncate text-xs text-foreground-secondary">{compact}</code>
      },
    },
  ], [t, fmt, props.showTenant])

  const columnLabels = useMemo(() => [
    { colId: 'occurredAt', label: t('audit.col.time') },
    { colId: 'actor', label: t('audit.col.actor') },
    { colId: 'kind', label: t('audit.col.kind') },
    { colId: 'operation', label: t('audit.col.operation') },
    { colId: 'object', label: t('audit.col.object') },
    ...(props.showTenant ? [{ colId: 'tenant', label: t('audit.col.tenant') }] : []),
    { colId: 'details', label: t('audit.col.details') },
  ], [t, props.showTenant])

  return (
    <>
      <GridToolbar
        gridApi={gridApi}
        columns={columnLabels}
        onClearFilters={() => resetGridFilters(gridApiRef.current, () => setParam(auditFilterModelToSearchParams({})))}
      />
      <DataGrid<AuditRow>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={row => row.id}
        initialFilterModel={auditUrlParamsToFilterModel(props) as Record<string, unknown>}
        initialSortModel={auditUrlParamsToSortModel(props)}
        onFilterChanged={(event: FilterChangedEvent<AuditRow>) =>
          setParam(auditFilterModelToSearchParams(event.api.getFilterModel() as AuditGridFilterModel))}
        onSortChanged={(event: SortChangedEvent<AuditRow>) => {
          const active = event.api.getColumnState().find(column => column.sort)
          setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
        }}
        onGridReady={(event: GridReadyEvent<AuditRow>) => { gridApiRef.current = event.api; setGridApi(event.api) }}
      />
    </>
  )
}
