'use client'

import React, { useId, useState } from 'react'
import { X } from 'lucide-react'
import { updateUserRoles } from '@/lib/rbac/users-actions'
import { ROLE_REGISTERED, type UserDTO } from '@/lib/rbac/types'
import RoleMultiSelect from './RoleMultiSelect'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'

export default function ManageRolesModal(
  { user, allRoles, onClose, onSaved }:
  { user: UserDTO; allRoles: { id: number; name: string }[]; onClose: () => void; onSaved: () => void },
) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Set<number>>(new Set(user.roles.map(r => r.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const toggle = (id: number) => {
    if (id === ROLE_REGISTERED) return // always kept, not toggleable
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await updateUserRoles(user.id, Array.from(selected))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('users.roles.save_error'))
      setBusy(false)
    }
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={onClose}
      busy={busy}
      panelClassName="bg-surface-overlay rounded-xl p-5 w-full max-w-md"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold">{t('users.actions.manage_roles')} — {user.firstName ?? user.email}</h2>
          <button data-dialog-initial-focus data-dialog-close onClick={onClose} aria-label={t('common.actions.close')} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <label className="block text-xs font-medium text-foreground-muted mb-1">{t('users.list.roles')}</label>
        <RoleMultiSelect
          options={allRoles}
          selected={selected}
          onToggle={toggle}
          lockedId={ROLE_REGISTERED}
          lockedLabel={t('users.roles.always_assigned')}
        />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button data-dialog-close onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-border">{t('common.actions.cancel')}</button>
          <button onClick={save} disabled={busy} data-testid="save-roles" className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">{t('common.actions.save')}</button>
        </div>
    </AccessibleDialog>
  )
}
