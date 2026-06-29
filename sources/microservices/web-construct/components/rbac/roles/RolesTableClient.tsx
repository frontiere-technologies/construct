'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'
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
  hasPermission: boolean
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
    router.push(`/rolesPermissions?${next.toString()}`)
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

  const onSort = (field: string) => {
    const dir = props.sortField === field && props.sortDir === 'ASC' ? 'DESC' : 'ASC'
    setParam({ sort: field, direction: dir })
  }

  const columns: Column<RolePageItemDto>[] = [
    { key: 'id', header: 'ID', sortable: true },
    { key: 'description', header: 'Nome ruolo', sortable: true, render: r => <span className="font-medium">{r.description}</span> },
    { key: 'associatedUsers', header: 'Utenti associati', sortable: true },
    { key: 'hasPermissions', header: 'Ha permessi', render: r => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${r.hasPermissions ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.hasPermissions ? 'Sì' : 'No'}
        </span>
      ) },
    { key: 'dateIns', header: 'Data di creazione', sortable: true, render: r => fmtDate(r.dateIns) },
    { key: 'dateMod', header: 'Ultimo aggiornamento', sortable: true, render: r => fmtDate(r.dateMod) },
  ]

  const filters = (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox" checked={props.hasPermission}
        onChange={e => setParam({ hasPermission: e.target.checked ? 'true' : null, page: '0' })}
      />
      Ha permessi
    </label>
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
        actionButton={<button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Nuovo ruolo</button>}
        onRowClick={r => router.push(`/rolesPermissions/${r.id}`)}
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
