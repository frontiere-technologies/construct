'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import ColumnVisibilityToggle from '@/components/ui/ColumnVisibilityToggle'
import GridRowActionsMenu from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import { createUsersDatasource } from './usersDatasource'
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
  allRoles: { id: number; name: string }[]
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
}

const COLUMN_LABELS = [
  { colId: 'firstName', label: 'Utente' },
  { colId: 'email', label: 'Email' },
  { colId: 'roles', label: 'Ruoli' },
  { colId: 'status', label: 'Stato' },
  { colId: 'dateIns', label: 'Creato' },
  { colId: 'dateMod', label: 'Aggiornato' },
]

export default function UsersTableClient(props: Props) {
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

  const setParam = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { p.delete(k) } else { p.set(k, v) } }
    p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === USER_STATUS_ACTIVE ? USER_STATUS_DEACTIVATED : USER_STATUS_ACTIVE
    if (!confirm(next === USER_STATUS_DEACTIVATED ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
    try { await setUserStatus(u.id, next); router.refresh(); gridApiRef.current?.refreshInfiniteCache() }
    catch (e) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const datasource = useMemo(() => createUsersDatasource(), [])

  // `page.tsx` re-fetches and re-maps `allRoles` on every filter/sort navigation, so
  // `props.allRoles` is a new array reference each time even when its content is identical.
  // Keying the memo on this derived string instead of the array itself avoids rebuilding
  // columnDefs (and the Ruolo filter's option list) on every unrelated interaction.
  const allRolesKey = props.allRoles.map(r => `${r.id}:${r.name}`).join('|')

  const columnDefs = useMemo<ColDef<UserDTO>[]>(() => [
    {
      colId: 'firstName', headerName: 'Utente', sortable: true,
      valueGetter: p => p.data ? fullName(p.data) : '',
      filter: 'agTextColumnFilter',
      filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
    },
    { field: 'email', headerName: 'Email', sortable: true, filter: false },
    {
      colId: 'roles', headerName: 'Ruoli', sortable: false, filter: EnumSelectFilter,
      filterParams: { options: props.allRoles.map(r => ({ value: r.id, label: r.name })) },
      valueGetter: p => p.data ? (p.data.roles.map(r => r.name).join(', ') || '—') : '',
    },
    {
      colId: 'status', headerName: 'Stato', sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: USER_STATUS_ACTIVE, label: 'Attivo' }, { value: USER_STATUS_DEACTIVATED, label: 'Disattivato' }] },
      cellRenderer: (p: { data?: UserDTO }) => p.data ? <StatusBadge status={p.data.status} /> : null,
    },
    {
      colId: 'dateIns', headerName: 'Creato', sortable: true,
      filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['inRange'], defaultOption: 'inRange', buttons: ['apply', 'reset'] },
      valueGetter: p => p.data ? new Date(p.data.createdAt).toLocaleDateString() : '',
    },
    {
      colId: 'dateMod', headerName: 'Aggiornato', sortable: true, filter: false,
      valueGetter: p => p.data?.updatedAt ? new Date(p.data.updatedAt).toLocaleDateString() : '—',
    },
    {
      colId: 'actions', headerName: '', sortable: false, filter: false, resizable: false, width: 56,
      cellRenderer: GridRowActionsMenu,
      cellRendererParams: {
        getItems: (u: UserDTO) => [
          { label: 'Gestisci ruoli', onClick: () => setManaging(u) },
          { label: u.status.idUserStatus === USER_STATUS_ACTIVE ? 'Disattiva' : 'Attiva', onClick: () => toggleStatus(u) },
        ],
      },
    },
  ], [allRolesKey]) // eslint-disable-line react-hooks/exhaustive-deps -- allRolesKey stands in for props.allRoles (see comment above)

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
      <div className="flex justify-end mb-3">
        <ColumnVisibilityToggle gridApi={gridApi} columns={COLUMN_LABELS} />
      </div>
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
