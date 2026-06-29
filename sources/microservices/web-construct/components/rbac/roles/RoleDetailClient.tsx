'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import PermissionsTree from '@/components/rbac/PermissionsTree'
import RenameRoleModal from './RenameRoleModal'
import { buildAuthMap, computeDeltas } from '@/lib/rbac/permission-tree'
import { updateRolePermissions } from '@/lib/rbac/roles-actions'
import type { RoleInformationDto, UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props {
  role: RoleInformationDto
  sezioniTree: UserNavigationTreeDto[]
  operazioniTree: UserNavigationTreeDto[]
}

export default function RoleDetailClient({ role, sezioniTree, operazioniTree }: Props) {
  const router = useRouter()
  const allTrees = useMemo(() => [...sezioniTree, ...operazioniTree], [sezioniTree, operazioniTree])
  const loaded = useMemo(() => buildAuthMap(allTrees), [allTrees])

  const [tab, setTab] = useState<'sezioni' | 'operazioni'>('sezioni')
  const [editing, setEditing] = useState(false)
  const [map, setMap] = useState<Map<number, boolean>>(loaded)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isSystem = role.roleType === 'SYSTEM'
  const canRename = role.roleType === 'SERVICE'

  const startEdit = () => { setMap(new Map(loaded)); setEditing(true) }
  const cancel = () => { setMap(new Map(loaded)); setEditing(false) }
  const save = async () => {
    setBusy(true)
    try {
      const deltas = computeDeltas(loaded, map)
      if (deltas.length) await updateRolePermissions(role.id, deltas)
      setEditing(false)
      router.refresh()
    } finally { setBusy(false) }
  }

  const trees = tab === 'sezioni' ? sezioniTree : operazioniTree

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-sm text-gray-500 mb-2"><Link href="/rolesPermissions" className="hover:text-gray-700 hover:underline">Ruoli &amp; permessi</Link> / Dettagli</div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">#{role.id} {role.roleName}</h1>
            {canRename && (
              <button data-testid="rename-role-btn" onClick={() => setRenaming(true)} className="text-gray-400 hover:text-gray-700"><Pencil size={18} /></button>
            )}
          </div>
          <p className="text-sm text-gray-500">{role.associatedUsersCount} Utenti associati</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={cancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">Annulla</button>
              <button onClick={save} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">Salva</button>
            </>
          ) : (
            <button
              onClick={startEdit} disabled={isSystem}
              title={isSystem ? 'I ruoli di sistema non sono modificabili' : undefined}
              className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >Modifica</button>
          )}
        </div>
      </div>

      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['sezioni', 'operazioni'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}
          >{t === 'sezioni' ? 'Sezioni' : 'Operazioni'}</button>
        ))}
      </div>

      <PermissionsTree trees={trees} map={map} onChange={setMap} editable={editing} />

      {renaming && <RenameRoleModal roleId={role.id} currentName={role.roleName} onClose={() => setRenaming(false)} />}
    </div>
  )
}
