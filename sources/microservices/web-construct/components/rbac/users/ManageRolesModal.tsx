'use client'

import React, { useId, useState } from 'react'
import { X } from 'lucide-react'
import { updateUserRoles } from '@/lib/rbac/users-actions'
import { ROLE_REGISTERED, type UserDto } from '@/lib/rbac/types'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'
import { Button } from '@/components/ui/button'
import RoleMultiSelect from './RoleMultiSelect'

export default function ManageRolesModal(
  { user, allRoles, onClose, onSaved }:
  { user: UserDto; allRoles: { id: number; name: string }[]; onClose: () => void; onSaved: () => void },
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
      panelClassName="bg-popover rounded-xl p-5 w-full max-w-md"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold">{t('users.actions.manage_roles')} — {user.firstName ?? user.email}</h2>
          <Button
            variant="ghost" size="icon"
            data-dialog-initial-focus data-dialog-close onClick={onClose} aria-label={t('common.actions.close')}
          ><X size={18} /></Button>
        </div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">{t('users.list.roles')}</label>
        <RoleMultiSelect
          options={allRoles}
          selected={selected}
          onToggle={toggle}
          lockedId={ROLE_REGISTERED}
          lockedLabel={t('users.roles.always_assigned')}
        />
        {error && <p className="text-sm text-destructive-muted-foreground mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button onClick={save} disabled={busy} data-testid="save-roles">{t('common.actions.save')}</Button>
        </div>
    </AccessibleDialog>
  )
}
