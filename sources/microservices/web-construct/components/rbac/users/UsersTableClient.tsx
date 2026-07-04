'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import CustomSelect from '@/components/rbac/CustomSelect'
import DateRangeFilter from '@/components/rbac/roles/DateRangeFilter'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from '@/lib/rbac/types'

interface Props {
  rows: UserDTO[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  allRoles: { id: number; name: string }[]
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
}

export default function UsersTableClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { p.delete(k) } else { p.set(k, v) } }
    if (!('page' in updates)) p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }, [sp, pathname, router])

  const [roleId, setRoleId] = useState<string>(props.roleId == null ? '' : String(props.roleId))
  const [statusId, setStatusId] = useState<string>(props.statusId == null ? '' : String(props.statusId))
  const [createdFrom, setCreatedFrom] = useState(props.createdFrom)
  const [createdTo, setCreatedTo] = useState(props.createdTo)
  const [search, setSearch] = useState(props.search)

  const syncDraftFromProps = useCallback(() => {
    setRoleId(props.roleId == null ? '' : String(props.roleId))
    setStatusId(props.statusId == null ? '' : String(props.statusId))
    setCreatedFrom(props.createdFrom)
    setCreatedTo(props.createdTo)
    setSearch(props.search)
  }, [props.roleId, props.statusId, props.createdFrom, props.createdTo, props.search])

  useEffect(() => {
    syncDraftFromProps()
  }, [syncDraftFromProps])

  const applyFilters = useCallback(() => {
    setParam({
      roleIds: roleId || null,
      statuses: statusId || null,
      createdFrom: createdFrom || null,
      createdTo: createdTo || null,
      search: search || null,
      page: '0',
    })
  }, [roleId, statusId, createdFrom, createdTo, search, setParam])

  const resetFilters = useCallback(() => {
    setRoleId('')
    setStatusId('')
    setCreatedFrom(null)
    setCreatedTo(null)
    setSearch('')
    setParam({ roleIds: null, statuses: null, createdFrom: null, createdTo: null, search: null, page: '0' })
  }, [setParam])

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === USER_STATUS_ACTIVE ? USER_STATUS_DEACTIVATED : USER_STATUS_ACTIVE
    if (!confirm(next === USER_STATUS_DEACTIVATED ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
    try { await setUserStatus(u.id, next); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const columns: Column<UserDTO>[] = [
    { key: 'firstName', header: 'Utente', sortable: true, render: u => fullName(u) },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'roles', header: 'Ruoli', render: u => u.roles.map(r => r.name).join(', ') || '—' },
    { key: 'status', header: 'Stato', sortable: true, render: u => <StatusBadge status={u.status} onToggle={() => toggleStatus(u)} /> },
    { key: 'dateIns', header: 'Creato', sortable: true, render: u => new Date(u.createdAt).toLocaleDateString() },
    { key: 'dateMod', header: 'Aggiornato', sortable: true, render: u => u.updatedAt ? new Date(u.updatedAt).toLocaleDateString() : '—' },
  ]

  const activeFilterCount =
    (props.roleId != null ? 1 : 0) +
    (props.statusId != null ? 1 : 0) +
    (props.search ? 1 : 0) +
    (props.createdFrom || props.createdTo ? 1 : 0)

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
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ruolo</label>
        <CustomSelect
          data-testid="filter-role"
          value={roleId}
          onChange={v => setRoleId(String(v))}
          options={props.allRoles.map(r => ({ value: r.id, label: r.name }))}
          placeholder="Tutti"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium block">Stato</label>
        <CustomSelect
          data-testid="filter-status"
          value={statusId}
          onChange={v => setStatusId(String(v))}
          options={[
            { value: USER_STATUS_ACTIVE, label: 'Attivo' },
            { value: USER_STATUS_DEACTIVATED, label: 'Disattivato' },
          ]}
          placeholder="Tutti"
        />
      </div>
      <DateRangeFilter
        startDate={createdFrom} endDate={createdTo}
        onChange={(s, e) => { setCreatedFrom(s); setCreatedTo(e) }}
      />
    </div>
  )

  return (
    <>
      <DataTable<UserDTO>
        columns={columns}
        rows={props.rows}
        rowKey={u => u.id}
        sort={{ field: props.sortField, direction: props.sortDir }}
        onSortChange={f => {
          const dir = props.sortField === f && props.sortDir === 'ASC' ? 'DESC' : 'ASC'
          setParam({ sort: f, direction: dir })
        }}
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={n => setParam({ page: String(n) })}
        rowMenu={u => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }]}
        filtersSlot={filters}
        onOpenFilters={syncDraftFromProps}
        onApplyFilters={applyFilters}
        onResetFilters={resetFilters}
        activeFilterCount={activeFilterCount}
        onClearFilters={resetFilters}
      />
      {managing && (
        <ManageRolesModal
          user={managing}
          allRoles={props.allRoles}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); router.refresh() }}
        />
      )}
    </>
  )
}
