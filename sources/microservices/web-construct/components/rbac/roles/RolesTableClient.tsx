'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
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
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<RolePageItemDto | null>(null)

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { next.delete(k) } else { next.set(k, v) } }
    router.push(`/roles-permissions?${next.toString()}`)
  }, [params, router])

  const [hasPermission, setHasPermission] = useState<string>(props.hasPermission == null ? '' : String(props.hasPermission))
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)
  const [search, setSearch] = useState(props.search)

  const syncDraftFromProps = useCallback(() => {
    setHasPermission(props.hasPermission == null ? '' : String(props.hasPermission))
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
    setSearch(props.search)
  }, [props.hasPermission, props.startDateIns, props.endDateIns, props.search])

  useEffect(() => {
    syncDraftFromProps()
  }, [syncDraftFromProps])

  const applyFilters = useCallback(() => {
    setParam({
      hasPermission: hasPermission || null,
      startDateIns: startDate || null,
      endDateIns: endDate || null,
      search: search || null,
      page: '0',
    })
  }, [hasPermission, startDate, endDate, search, setParam])

  const resetFilters = useCallback(() => {
    setHasPermission('')
    setStartDate(null)
    setEndDate(null)
    setSearch('')
    setParam({ hasPermission: null, startDateIns: null, endDateIns: null, search: null, page: '0' })
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

  const activeFilterCount =
    (props.hasPermission != null ? 1 : 0) +
    (props.search?.trim() ? 1 : 0) +
    (props.startDateIns || props.endDateIns ? 1 : 0)

  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Cerca</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="filter-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface-overlay"
          />
        </div>
      </div>
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
        filtersSlot={filters}
        onOpenFilters={syncDraftFromProps}
        onApplyFilters={applyFilters}
        onResetFilters={resetFilters}
        activeFilterCount={activeFilterCount}
        onClearFilters={resetFilters}
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
