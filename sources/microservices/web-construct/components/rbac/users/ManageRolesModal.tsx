'use client'

import React, { useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { updateUserRoles } from '@/lib/rbac/users-actions'
import type { UserDto } from '@/lib/rbac/types'
import { useI18n } from '@/context/I18nContext'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import RoleMultiSelect from './RoleMultiSelect'

interface Props {
  user: UserDto
  allRoles: { id: number; name: string }[]
  /** I ruoli che l'attore può assegnare e togliere (DEC-29), calcolati dalla pagina con le regole
   *  di `grant-guards.ts` (DEC-32). Gli altri restano visibili e disabilitati. */
  assignableRoleIds: number[]
  /** Il ruolo base del tenant, sempre assegnato: lo calcola la pagina dal server (MTF-DEC-5). */
  registeredRoleId: number
  onClose: () => void
  onSaved: () => void
}

export default function ManageRolesModal({ user, allRoles, assignableRoleIds, registeredRoleId, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const unassignable = useMemo(() => {
    const assignable = new Set(assignableRoleIds)
    return new Set(allRoles.filter(r => !assignable.has(r.id)).map(r => r.id))
  }, [allRoles, assignableRoleIds])
  const [selected, setSelected] = useState<Set<number>>(new Set(user.roles.map(r => r.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const toggle = (id: number) => {
    if (id === registeredRoleId || unassignable.has(id)) return // always kept / not the actor's to change
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
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">{t('users.actions.manage_roles')} — {user.firstName ?? user.email}</h2>
          <Button
            variant="ghost" size="icon" className="shrink-0"
            data-dialog-initial-focus data-dialog-close onClick={onClose} aria-label={t('common.actions.close')}
          ><X size={18} /></Button>
        </div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">{t('users.list.roles')}</label>
        <RoleMultiSelect
          options={allRoles}
          selected={selected}
          onToggle={toggle}
          lockedId={registeredRoleId}
          lockedLabel={t('users.roles.always_assigned')}
          disabledIds={unassignable}
          disabledHint={t('users.roles.not_assignable_hint')}
        />
        {error && <p className="text-sm text-destructive-muted-foreground mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button onClick={save} disabled={busy} data-testid="save-roles">{t('common.actions.save')}</Button>
        </div>
    </AccessibleDialog>
  )
}
