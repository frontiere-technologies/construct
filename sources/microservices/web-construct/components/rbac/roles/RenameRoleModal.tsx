'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameRole } from '@/lib/rbac/roles-actions'

export default function RenameRoleModal({ roleId, currentName, onClose }: { roleId: number; currentName: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await renameRole(roleId, name); router.refresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Rinomina ruolo</h2>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome ruolo"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 mb-6"
        />
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-medium">Annulla</button>
          <button onClick={submit} disabled={!name.trim() || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">Salva</button>
        </div>
      </div>
    </div>
  )
}
