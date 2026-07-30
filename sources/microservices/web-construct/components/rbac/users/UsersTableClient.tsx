'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import GridToolbar from '@/components/ui/GridToolbar'
import { DATE_FILTER, TEXT_FILTER } from '@/components/ui/gridColumnFilters'
import { resetGridFilters } from '@/components/ui/grid-reset'
import { useGridUrlSync } from '@/components/ui/grid-url-sync'
import { actionsColumnDef } from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import { createUsersDatasource } from './usersDatasource'
import { useI18n } from '@/context/I18nContext'
import {
  usersUrlParamsToFilterModel, usersUrlParamsToSortModel, usersFilterModelToSearchParams,
  type UsersGridFilterModel,
} from '@/lib/rbac/users-grid-query'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from '@/lib/rbac/types'

interface Props {
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  search2: string
  searchOperator: 'AND' | 'OR' | null
  emailSearch: string
  emailSearch2: string
  emailSearchOperator: 'AND' | 'OR' | null
  allRoles: { id: number; name: string }[]
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
  updatedFrom: string | null
  updatedTo: string | null
}

export default function UsersTableClient(props: Props) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<UserDTO> | null>(null)
  // Kept alongside the `gridApi` state: `columnDefs` below is memoized and its cell
  // renderers close over `toggleStatus`, so a ref (always current, regardless of when
  // the memo last recomputed) is used inside those closures instead of the state value,
  // which could otherwise stay stale at `null` from before onGridReady fired.
  const gridApiRef = useRef<GridApi<UserDTO> | null>(null)

  const gridUrlSync = useGridUrlSync(pathname, sp.toString(), url => router.replace(url))
  const setParam = (updates: Record<string, string | null>) => gridUrlSync.update(updates)

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === USER_STATUS_ACTIVE ? USER_STATUS_DEACTIVATED : USER_STATUS_ACTIVE
    const confirmMessage = next === USER_STATUS_DEACTIVATED
      ? t('users.confirm.deactivate', { email: u.email })
      : t('users.confirm.activate', { email: u.email })
    if (!confirm(confirmMessage)) return
    try { await setUserStatus(u.id, next); router.refresh(); gridApiRef.current?.refreshInfiniteCache() }
    catch (e) { alert(e instanceof Error ? e.message : t('errors.generic')) }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const datasource = useMemo(() => createUsersDatasource(), [])

  // `page.tsx` re-fetches and re-maps `allRoles` on every filter/sort navigation, so
  // `props.allRoles` is a new array reference each time even when its content is identical.
  // Keying the memo on this derived string instead of the array itself avoids rebuilding
  // columnDefs (and the Ruolo filter's option list) on every unrelated interaction.
  const allRolesKey = props.allRoles.map(r => `${r.id}:${r.name}`).join('|')
  const textFilter = TEXT_FILTER as Pick<ColDef<UserDTO>, 'filter' | 'filterParams'>
  const dateFilter = DATE_FILTER as Pick<ColDef<UserDTO>, 'filter' | 'filterParams'>

  const columnDefs = useMemo<ColDef<UserDTO>[]>(() => [
    actionsColumnDef<UserDTO>(u => [
      { label: t('users.actions.manage_roles'), onClick: () => setManaging(u) },
      { label: u.status.idUserStatus === USER_STATUS_ACTIVE ? t('users.actions.deactivate') : t('users.actions.activate'), onClick: () => toggleStatus(u) },
    ]),
    {
      colId: 'firstName', headerName: t('users.list.name'), sortable: true,
      valueGetter: p => p.data ? fullName(p.data) : '',
      ...textFilter,
    },
    { field: 'email', headerName: t('users.list.email'), sortable: true, ...textFilter },
    {
      colId: 'roles', headerName: t('users.list.roles'), sortable: false, filter: EnumSelectFilter,
      filterParams: { options: props.allRoles.map(r => ({ value: r.id, label: r.name })) },
      valueGetter: p => p.data ? (p.data.roles.map(r => r.name).join(', ') || '—') : '',
    },
    {
      colId: 'status', headerName: t('users.list.status'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: USER_STATUS_ACTIVE, label: t('users.status.active') }, { value: USER_STATUS_DEACTIVATED, label: t('users.status.deactivated') }] },
      cellRenderer: (p: { data?: UserDTO }) => p.data ? <StatusBadge status={p.data.status} /> : null,
    },
    {
      colId: 'dateIns', headerName: t('users.list.created_at'), sortable: true,
      ...dateFilter,
      valueGetter: p => p.data ? fmt.date(p.data.createdAt) : '',
    },
    {
      colId: 'dateMod', headerName: t('users.list.updated_at'), sortable: true,
      ...dateFilter,
      valueGetter: p => p.data?.updatedAt ? fmt.date(p.data.updatedAt) : '—',
    },
  ], [allRolesKey, t, fmt]) // eslint-disable-line react-hooks/exhaustive-deps -- allRolesKey stands in for props.allRoles (see comment above); toggleStatus is intentionally omitted too, same as before this change

  const columnLabels = useMemo(() => [
    { colId: 'firstName', label: t('users.list.name') },
    { colId: 'email', label: t('users.list.email') },
    { colId: 'roles', label: t('users.list.roles') },
    { colId: 'status', label: t('users.list.status') },
    { colId: 'dateIns', label: t('users.list.created_at') },
    { colId: 'dateMod', label: t('users.list.updated_at') },
  ], [t])

  const onFilterChanged = (event: FilterChangedEvent<UserDTO>) => {
    const model = event.api.getFilterModel() as UsersGridFilterModel
    setParam(usersFilterModelToSearchParams(model))
  }

  const onSortChanged = (event: SortChangedEvent<UserDTO>) => {
    const active = event.api.getColumnState().find(c => c.sort)
    setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
  }

  const onGridReady = (event: GridReadyEvent<UserDTO>) => {
    gridApiRef.current = event.api
    setGridApi(event.api)
  }

  return (
    <>
      <GridToolbar
        gridApi={gridApi}
        columns={columnLabels}
        onClearFilters={() => resetGridFilters(gridApiRef.current, () => setParam(usersFilterModelToSearchParams({})))}
      />
      <DataGrid<UserDTO>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={u => u.id}
        initialFilterModel={usersUrlParamsToFilterModel(props) as Record<string, unknown>}
        initialSortModel={usersUrlParamsToSortModel(props)}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onGridReady={onGridReady}
      />
      {managing && (
        <ManageRolesModal
          user={managing}
          allRoles={props.allRoles}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); router.refresh(); gridApi?.refreshInfiniteCache() }}
        />
      )}
    </>
  )
}
