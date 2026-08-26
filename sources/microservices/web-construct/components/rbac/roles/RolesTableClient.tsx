'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import GridToolbar from '@/components/ui/GridToolbar'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { Button } from '@/components/ui/button'
import { resetGridFilters } from '@/components/ui/grid-reset'
import { useGridUrlSync } from '@/components/ui/grid-url-sync'
import { DATE_FILTER, NUMBER_FILTER, TEXT_FILTER } from '@/components/ui/gridColumnFilters'
import { actionsColumnDef } from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import { deleteRole } from '@/lib/rbac/roles-actions'
import { useI18n } from '@/context/I18nContext'
import {
  rolesUrlParamsToFilterModel, rolesUrlParamsToSortModel, rolesFilterModelToSearchParams,
  type RolesGridFilterModel,
} from '@/lib/rbac/roles-grid-query'
import type { RolePageItemDto } from '@/lib/rbac/types'
import { createRolesDatasource } from './rolesDatasource'
import RenameRoleModal from './RenameRoleModal'
import CreateRoleModal from './CreateRoleModal'

const ROLE_TEXT_FILTER = TEXT_FILTER as Pick<ColDef<RolePageItemDto>, 'filter' | 'filterParams'>
const ROLE_NUMBER_FILTER = NUMBER_FILTER as Pick<ColDef<RolePageItemDto>, 'filter' | 'filterParams'>
const ROLE_DATE_FILTER = DATE_FILTER as Pick<ColDef<RolePageItemDto>, 'filter' | 'filterParams'>

interface Props {
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  search2: string
  searchOperator: 'AND' | 'OR' | null
  idMin: number | null
  idMax: number | null
  associatedUsersMin: number | null
  associatedUsersMax: number | null
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
  startDateMod: string | null
  endDateMod: string | null
}

export default function RolesTableClient(props: Props) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<RolePageItemDto | null>(null)
  const [deleting, setDeleting] = useState<RolePageItemDto | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<RolePageItemDto> | null>(null)
  // Kept alongside the `gridApi` state: `columnDefs` below is memoized and its "Elimina"
  // row-action closure captures `gridApi`, so a ref (always current, regardless of when
  // the memo last recomputed) is used inside that closure instead of the state value,
  // which could otherwise stay stale at `null` from before onGridReady fired.
  const gridApiRef = useRef<GridApi<RolePageItemDto> | null>(null)

  const gridUrlSync = useGridUrlSync(pathname, sp.toString(), url => router.replace(url))
  const setParam = (updates: Record<string, string | null>) => gridUrlSync.update(updates)

  const datasource = useMemo(() => createRolesDatasource(), [])

  const columnDefs = useMemo<ColDef<RolePageItemDto>[]>(() => [
    actionsColumnDef<RolePageItemDto>(r => [
      { label: t('common.actions.open'), onClick: () => router.push(`/roles-permissions/${r.id}`) },
      { label: t('common.actions.rename'), disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
      { label: t('common.actions.delete'), disabled: r.roleType === 'SYSTEM', onClick: () => setDeleting(r) },
    ]),
    { field: 'id', headerName: t('roles.list.id'), sortable: true, ...ROLE_NUMBER_FILTER },
    {
      field: 'description', headerName: t('roles.form.name'), sortable: true,
      ...ROLE_TEXT_FILTER,
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? <span className="font-medium">{p.data.description}</span> : null,
    },
    { field: 'associatedUsers', headerName: t('roles.list.associated_users'), sortable: true, ...ROLE_NUMBER_FILTER },
    {
      colId: 'hasPermissions', headerName: t('roles.list.has_permissions'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: 'true', label: t('common.labels.yes') }, { value: 'false', label: t('common.labels.no') }] },
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? (
        <span className={`px-2 py-0.5 rounded-full text-xs ${p.data.hasPermissions ? 'bg-success-muted text-success-muted-foreground' : 'bg-accent text-foreground-secondary'}`}>
          {p.data.hasPermissions ? t('common.labels.yes') : t('common.labels.no')}
        </span>
      ) : null,
    },
    {
      field: 'dateIns', headerName: t('roles.list.created_at'), sortable: true,
      ...ROLE_DATE_FILTER,
      valueGetter: p => p.data ? fmt.date(p.data.dateIns) : '',
    },
    { field: 'dateMod', headerName: t('roles.list.updated_at'), sortable: true, ...ROLE_DATE_FILTER, valueGetter: p => p.data ? fmt.date(p.data.dateMod) : '' },
  ], [router, t, fmt])

  const columnLabels = useMemo(() => [
    { colId: 'id', label: t('roles.list.id') },
    { colId: 'description', label: t('roles.form.name') },
    { colId: 'associatedUsers', label: t('roles.list.associated_users') },
    { colId: 'hasPermissions', label: t('roles.list.has_permissions') },
    { colId: 'dateIns', label: t('roles.list.created_at') },
    { colId: 'dateMod', label: t('roles.list.updated_at') },
  ], [t])

  const onFilterChanged = (event: FilterChangedEvent<RolePageItemDto>) => {
    const model = event.api.getFilterModel() as RolesGridFilterModel
    setParam(rolesFilterModelToSearchParams(model))
  }

  const onSortChanged = (event: SortChangedEvent<RolePageItemDto>) => {
    const active = event.api.getColumnState().find(c => c.sort)
    setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
  }

  const onGridReady = (event: GridReadyEvent<RolePageItemDto>) => {
    gridApiRef.current = event.api
    setGridApi(event.api)
  }

  const onClearFilters = () => resetGridFilters(gridApi, () => setParam(rolesFilterModelToSearchParams({})))

  return (
    <>
      <GridToolbar gridApi={gridApi} columns={columnLabels} onClearFilters={onClearFilters}>
        <Button size="sm" onClick={() => setShowCreate(true)}>{t('roles.actions.create')}</Button>
      </GridToolbar>
      <DataGrid<RolePageItemDto>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={r => String(r.id)}
        initialFilterModel={rolesUrlParamsToFilterModel(props) as Record<string, unknown>}
        initialSortModel={rolesUrlParamsToSortModel(props)}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onGridReady={onGridReady}
      />
      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} />}
      {renaming && <RenameRoleModal roleId={renaming.id} currentName={renaming.description} onClose={() => { setRenaming(null); gridApi?.refreshInfiniteCache() }} />}
      {deleting && (
        <ConfirmModal
          title={t('roles.confirm.delete_title')}
          message={t('roles.confirm.delete_message', { name: deleting.description })}
          confirmLabel={t('common.actions.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteRole(deleting.id)
            setDeleting(null)
            router.refresh()
            gridApiRef.current?.refreshInfiniteCache()
          }}
        />
      )}
    </>
  )
}
