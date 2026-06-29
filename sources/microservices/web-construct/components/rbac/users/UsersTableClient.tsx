'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import type { UserDTO } from '@/lib/rbac/types'

interface Props {
  rows: UserDTO[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  allRoles: { id: number; name: string }[]
}

export default function UsersTableClient({ rows, page, totalPages, sortField, sortDir, search, allRoles }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString())
    if (v == null || v === '') p.delete(k); else p.set(k, v)
    if (k !== 'page') p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === 2 ? 1 : 2
    if (!confirm(next === 1 ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
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

  return (
    <>
      <DataTable<UserDTO>
        columns={columns}
        rows={rows}
        rowKey={u => u.id}
        sort={{ field: sortField, direction: sortDir }}
        onSortChange={f => {
          const dir = sortField === f && sortDir === 'ASC' ? 'DESC' : 'ASC'
          const p = new URLSearchParams(sp.toString())
          p.set('sort', f); p.set('direction', dir); p.delete('page')
          router.push(`${pathname}?${p.toString()}`)
        }}
        page={page}
        totalPages={totalPages}
        onPageChange={n => setParam('page', String(n))}
        search={search}
        onSearchChange={v => setParam('search', v)}
        rowMenu={u => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }]}
      />
      {managing && (
        <ManageRolesModal
          user={managing}
          allRoles={allRoles}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); router.refresh() }}
        />
      )}
    </>
  )
}
