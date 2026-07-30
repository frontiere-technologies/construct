'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/lib/rbac/roles-actions'
import { useI18n } from '@/context/I18nContext'

export default function CreateRoleModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
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
        <h2 className="text-lg font-bold mb-2">{t('roles.form.create_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('roles.form.create_subtitle')}</p>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={t('roles.form.name')}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface-overlay mb-6"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-border">{t('common.actions.cancel')}</button>
          <button
            onClick={submit} disabled={!name.trim() || busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >{t('common.actions.save')}</button>
        </div>
      </div>
    </div>
  )
}
