'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'
import DateRangeFilter from './DateRangeFilter'
import CustomSelect from '@/components/rbac/CustomSelect'
import { deleteRole } from '@/lib/rbac/roles-actions'
import type { RolePageItemDto } from '@/lib/rbac/types'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  rows: RolePageItemDto[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
}

export default function RolesTableClient(props: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(props.search)
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<RolePageItemDto | null>(null)

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { next.delete(k) } else { next.set(k, v) } }
    router.push(`/roles-permissions?${next.toString()}`)
  }, [params, router])

  // Sync local search with URL on navigation (back/forward)
  useEffect(() => {
    setSearch(props.search)
  }, [props.search])

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== props.search) setParam({ search: search || null, page: '0' })
    }, 350)
    return () => clearTimeout(t)
  }, [search, props.search, setParam])

  const [hasPermission, setHasPermission] = useState<string>(props.hasPermission == null ? '' : String(props.hasPermission))
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)

  const syncDraftFromProps = useCallback(() => {
    setHasPermission(props.hasPermission == null ? '' : String(props.hasPermission))
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
  }, [props.hasPermission, props.startDateIns, props.endDateIns])

  useEffect(() => {
    syncDraftFromProps()
  }, [syncDraftFromProps])

  const applyFilters = useCallback(() => {
    setParam({
      hasPermission: hasPermission || null,
      startDateIns: startDate || null,
      endDateIns: endDate || null,
      page: '0',
    })
  }, [hasPermission, startDate, endDate, setParam])

  const resetFilters = useCallback(() => {
    setHasPermission('')
    setStartDate(null)
    setEndDate(null)
    setParam({ hasPermission: null, startDateIns: null, endDateIns: null, page: '0' })
  }, [setParam])

  const onSort = (field: string) => {
    const dir = props.sortField === field && props.sortDir === 'ASC' ? 'DESC' : 'ASC'
    setParam({ sort: field, direction: dir })
  }

  const columns: Column<RolePageItemDto>[] = [
    { key: 'id', header: 'ID', sortable: true },
    { key: 'description', header: 'Nome ruolo', sortable: true, render: r => <span className="font-medium">{r.description}</span> },
    { key: 'associatedUsers', header: 'Utenti associati', sortable: true },
    { key: 'hasPermissions', header: 'Ha permessi', sortable: true, render: r => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${r.hasPermissions ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.hasPermissions ? 'Sì' : 'No'}
        </span>
      ) },
    { key: 'dateIns', header: 'Data di creazione', sortable: true, render: r => fmtDate(r.dateIns) },
    { key: 'dateMod', header: 'Ultimo aggiornamento', sortable: true, render: r => fmtDate(r.dateMod) },
  ]

  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ha permessi</label>
        <CustomSelect
          data-testid="filter-has-permission"
          value={hasPermission}
          onChange={v => setHasPermission(String(v))}
          options={[{ value: 'true', label: 'Sì' }, { value: 'false', label: 'No' }]}
          placeholder="Tutti"
        />
      </div>
      <DateRangeFilter
        startDate={startDate} endDate={endDate}
        onChange={(s, e) => { setStartDate(s); setEndDate(e) }}
      />
    </div>
  )

  return (
    <>
      <DataTable
        columns={columns}
        rows={props.rows}
        rowKey={r => r.id}
        sort={{ field: props.sortField, direction: props.sortDir }}
        onSortChange={onSort}
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={p => setParam({ page: String(p) })}
        search={search}
        onSearchChange={setSearch}
        filtersSlot={filters}
        onOpenFilters={syncDraftFromProps}
        onApplyFilters={applyFilters}
        onResetFilters={resetFilters}
        actionButton={<button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Nuovo ruolo</button>}
        onRowClick={r => router.push(`/roles-permissions/${r.id}`)}
        rowMenu={r => [
          { label: 'Rinomina', disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
          { label: 'Elimina', disabled: r.roleType === 'SYSTEM', onClick: async () => {
              if (confirm(`Eliminare il ruolo "${r.description}"?`)) { await deleteRole(r.id); router.refresh() }
            } },
        ]}
      />
      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} />}
      {renaming && <RenameRoleModal roleId={renaming.id} currentName={renaming.description} onClose={() => setRenaming(null)} />}
    </>
  )
}
