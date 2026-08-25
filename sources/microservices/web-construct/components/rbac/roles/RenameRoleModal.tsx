'use client'

import React, { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameRole } from '@/lib/rbac/roles-actions'
import { useI18n } from '@/context/I18nContext'
import AccessibleDialog from '@/components/ui/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RenameRoleModal({ roleId, currentName, onClose }: { roleId: number; currentName: string; onClose: () => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await renameRole(roleId, name); router.refresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={onClose}
      busy={busy}
      panelClassName="w-full max-w-md rounded-xl bg-popover p-6 shadow-xl"
    >
        <h2 id={titleId} className="text-lg font-bold mb-4">{t('roles.rename.title')}</h2>
        <Input
          data-dialog-initial-focus value={name} onChange={e => setName(e.target.value)} placeholder={t('roles.form.name')}
          className="mb-6"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button onClick={submit} disabled={!name.trim() || busy} data-testid="rename-role-save">{t('common.actions.save')}</Button>
        </div>
    </AccessibleDialog>
  )
}
