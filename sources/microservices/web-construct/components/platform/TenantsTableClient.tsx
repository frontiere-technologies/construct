'use client'

import React, { useMemo, useRef, useState } from 'react'
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
  TENANT_STATUSES, tenantsFilterModelToSearchParams, tenantsUrlParamsToFilterModel, tenantsUrlParamsToSortModel,
  type PlatformTenantRow, type TenantsGridFilterModel, type TenantsUrlParams,
} from '@/lib/platform/tenants-grid-query'
import { TenantStatusBadge } from './TenantStatusBadge'
import { createTenantsDatasource } from './tenants-datasource'

const TENANT_TEXT_FILTER = TEXT_FILTER as Pick<ColDef<PlatformTenantRow>, 'filter' | 'filterParams'>
const TENANT_DATE_FILTER = DATE_FILTER as Pick<ColDef<PlatformTenantRow>, 'filter' | 'filterParams'>

type Cell = { data?: PlatformTenantRow }

/**
 * L'elenco dei tenant della console (specifica 2026-10-26, MT5-DEC-4): nome, slug, indirizzo
 * principale, stato, persone attive, amministratori, data di creazione. Il modello arriva in cima
 * dal server, segnato a parte; gli archiviati si vedono solo con il filtro di stato. Le persone attive
 * e gli amministratori si contano tenant per tenant e non si ordinano né si filtrano.
 */
export function TenantsTableClient(props: TenantsUrlParams) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [gridApi, setGridApi] = useState<GridApi<PlatformTenantRow> | null>(null)
  const gridApiRef = useRef<GridApi<PlatformTenantRow> | null>(null)

  const gridUrlSync = useGridUrlSync(pathname, sp.toString(), url => router.replace(url))
  const setParam = (updates: Record<string, string | null>) => gridUrlSync.update(updates)
  const datasource = useMemo(() => createTenantsDatasource(), [])

  const columnDefs = useMemo<ColDef<PlatformTenantRow>[]>(() => [
    {
      field: 'name', headerName: t('platform.tenants.name'), sortable: true, ...TENANT_TEXT_FILTER,
      cellRenderer: ({ data }: Cell) => data ? (
        <span className="flex items-center gap-2">
          <span className="font-medium">{data.name}</span>
          {data.isTemplate && (
            <span data-testid="tenant-template-badge" className="rounded-full bg-accent px-2 py-0.5 text-xs text-foreground-secondary">
              {t('platform.tenants.template_badge')}
            </span>
          )}
        </span>
      ) : null,
    },
    { field: 'slug', headerName: t('platform.tenants.slug'), sortable: true, ...TENANT_TEXT_FILTER },
    {
      colId: 'host', field: 'primaryHost', headerName: t('platform.tenants.host'), sortable: true, ...TENANT_TEXT_FILTER,
      valueGetter: p => p.data ? (p.data.primaryHost ?? '—') : '',
    },
    {
      colId: 'status', field: 'status', headerName: t('platform.tenants.status'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: TENANT_STATUSES.map(value => ({ value, label: t(`platform.tenants.status.${value}`) })) },
      cellRenderer: ({ data }: Cell) => data ? <TenantStatusBadge status={data.status} /> : null,
    },
    { field: 'activeMembers', headerName: t('platform.tenants.members'), sortable: false },
    {
      field: 'adminEmails', headerName: t('platform.tenants.admins'), sortable: false,
      cellRenderer: ({ data }: Cell) => data ? <span className="truncate">{data.adminEmails.join(', ')}</span> : null,
    },
    {
      colId: 'createdAt', field: 'createdAt', headerName: t('platform.tenants.created_at'), sortable: true, ...TENANT_DATE_FILTER,
      valueGetter: p => p.data ? fmt.date(p.data.createdAt) : '',
    },
  ], [t, fmt])

  const columnLabels = useMemo(() => [
    { colId: 'name', label: t('platform.tenants.name') },
    { colId: 'slug', label: t('platform.tenants.slug') },
    { colId: 'host', label: t('platform.tenants.host') },
    { colId: 'status', label: t('platform.tenants.status') },
    { colId: 'activeMembers', label: t('platform.tenants.members') },
    { colId: 'adminEmails', label: t('platform.tenants.admins') },
    { colId: 'createdAt', label: t('platform.tenants.created_at') },
  ], [t])

  return (
    <>
      <GridToolbar
        gridApi={gridApi}
        columns={columnLabels}
        onClearFilters={() => resetGridFilters(gridApi, () => setParam(tenantsFilterModelToSearchParams({})))}
      />
      <DataGrid<PlatformTenantRow>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={row => String(row.id)}
        initialFilterModel={tenantsUrlParamsToFilterModel(props) as Record<string, unknown>}
        initialSortModel={tenantsUrlParamsToSortModel(props)}
        onFilterChanged={(event: FilterChangedEvent<PlatformTenantRow>) =>
          setParam(tenantsFilterModelToSearchParams(event.api.getFilterModel() as TenantsGridFilterModel))}
        onSortChanged={(event: SortChangedEvent<PlatformTenantRow>) => {
          const active = event.api.getColumnState().find(column => column.sort)
          setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
        }}
        onGridReady={(event: GridReadyEvent<PlatformTenantRow>) => { gridApiRef.current = event.api; setGridApi(event.api) }}
      />
    </>
  )
}
