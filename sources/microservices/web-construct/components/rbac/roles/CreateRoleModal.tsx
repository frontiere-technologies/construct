'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/lib/rbac/roles-actions'

export default function CreateRoleModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const { id } = await createRole(name)
      router.push(`/roles-permissions/${id}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface-overlay p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Crea nuovo ruolo</h2>
        <p className="text-sm text-gray-500 mb-4">Per procedere con la creazione di un nuovo ruolo, inserisci il nome del ruolo desiderato</p>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome ruolo"
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface-overlay mb-6"
        />
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-medium">Annulla</button>
          <button
            onClick={submit} disabled={!name.trim() || busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >Crea nuovo ruolo</button>
        </div>
      </div>
    </div>
  )
}
