'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import ColumnVisibilityToggle from '@/components/ui/ColumnVisibilityToggle'
import ConfirmModal from '@/components/ui/ConfirmModal'
import GridRowActionsMenu from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'
import { deleteRole } from '@/lib/rbac/roles-actions'
import { createRolesDatasource } from './rolesDatasource'
import {
  rolesUrlParamsToFilterModel, rolesUrlParamsToSortModel, rolesFilterModelToSearchParams,
  type RolesGridFilterModel,
} from '@/lib/rbac/roles-grid-query'
import type { RolePageItemDto } from '@/lib/rbac/types'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
}

const COLUMN_LABELS = [
  { colId: 'id', label: 'ID' },
  { colId: 'description', label: 'Nome ruolo' },
  { colId: 'associatedUsers', label: 'Utenti associati' },
  { colId: 'hasPermissions', label: 'Ha permessi' },
  { colId: 'dateIns', label: 'Data di creazione' },
  { colId: 'dateMod', label: 'Ultimo aggiornamento' },
]

export default function RolesTableClient(props: Props) {
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

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { next.delete(k) } else { next.set(k, v) } }
    next.delete('page')
    router.push(`${pathname}?${next.toString()}`)
  }

  const datasource = useMemo(() => createRolesDatasource(), [])

  const columnDefs = useMemo<ColDef<RolePageItemDto>[]>(() => [
    { field: 'id', headerName: 'ID', sortable: true, filter: false },
    {
      field: 'description', headerName: 'Nome ruolo', sortable: true,
      filter: 'agTextColumnFilter',
      filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? <span className="font-medium">{p.data.description}</span> : null,
    },
    { field: 'associatedUsers', headerName: 'Utenti associati', sortable: true, filter: false },
    {
      colId: 'hasPermissions', headerName: 'Ha permessi', sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: 'true', label: 'Sì' }, { value: 'false', label: 'No' }] },
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? (
        <span className={`px-2 py-0.5 rounded-full text-xs ${p.data.hasPermissions ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {p.data.hasPermissions ? 'Sì' : 'No'}
        </span>
      ) : null,
    },
    {
      colId: 'dateIns', headerName: 'Data di creazione', sortable: true,
      filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['inRange'], defaultOption: 'inRange', buttons: ['apply', 'reset'] },
      valueGetter: p => p.data ? fmtDate(p.data.dateIns) : '',
    },
    { field: 'dateMod', headerName: 'Ultimo aggiornamento', sortable: true, filter: false, valueGetter: p => p.data ? fmtDate(p.data.dateMod) : '' },
    {
      colId: 'actions', headerName: '', sortable: false, filter: false, resizable: false, width: 56,
      cellRenderer: GridRowActionsMenu,
      cellRendererParams: {
        getItems: (r: RolePageItemDto) => [
          { label: 'Apri', onClick: () => router.push(`/roles-permissions/${r.id}`) },
          { label: 'Rinomina', disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
          { label: 'Elimina', disabled: r.roleType === 'SYSTEM', onClick: () => setDeleting(r) },
        ],
      },
    },
  ], [router])

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

  return (
    <>
      <div className="flex justify-end items-center gap-2 mb-3">
        <ColumnVisibilityToggle gridApi={gridApi} columns={COLUMN_LABELS} />
        <button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Nuovo ruolo</button>
      </div>
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
          title="Elimina ruolo"
          message={`Eliminare il ruolo "${deleting.description}"?`}
          confirmLabel="Elimina"
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
