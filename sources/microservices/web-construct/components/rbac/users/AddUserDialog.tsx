'use client'

import React, { useId, useState, type FormEvent } from 'react'
import { addUserByEmail } from '@/lib/rbac/users-actions'
import { emailSchema } from '@/lib/rbac/action-input-schemas'
import { useI18n } from '@/context/I18nContext'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  canInvite: boolean
  onClose: () => void
  onRefresh: () => void
}

type Outcome = { kind: 'done' | 'invalid' | 'error' | 'member_quota' | 'capability_unavailable' } | null

export function AddUserDialog({ open, canInvite, onClose, onRefresh }: Props) {
  // Il modulo interno si smonta alla chiusura, così riaprendo il dialogo il campo e l'esito
  // ripartono da zero senza un effetto che li azzeri.
  return open ? <AddUserForm canInvite={canInvite} onClose={onClose} onRefresh={onRefresh} /> : null
}

function AddUserForm({ canInvite, onClose, onRefresh }: Omit<Props, 'open'>) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const titleId = useId()
  const fieldId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canInvite) return
    // Lo stesso schema del server: l'indirizzo scritto male non parte nemmeno.
    if (!emailSchema.safeParse(email).success) { setOutcome({ kind: 'invalid' }); return }
    setBusy(true); setOutcome(null)
    try {
      const result = await addUserByEmail(email)
      setOutcome({ kind: result.ok ? 'done' : result.reason })
      onRefresh()
    } catch {
      // Il messaggio dell'azione non arriva in produzione e non va mostrato: l'esito è neutro.
      setOutcome({ kind: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog
      titleId={titleId}
      onClose={onClose}
      busy={busy}
      panelClassName="bg-popover rounded-xl p-5 w-full max-w-md"
    >
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="mb-4 text-lg font-semibold">{t('users.add.title')}</h2>
        <label htmlFor={fieldId} className="block text-xs font-medium text-muted-foreground mb-1">
          {t('users.add.email_label')}
        </label>
        <Input
          id={fieldId} type="email" autoComplete="off" data-dialog-initial-focus value={email}
          onChange={e => { setEmail(e.target.value); setOutcome(null) }} disabled={!canInvite}
        />
        <div className="mt-3 min-h-5 text-sm">
          {outcome?.kind === 'done' && <p role="status" className="text-foreground">{t('users.add.done')}</p>}
          {outcome?.kind === 'invalid' && (
            <p role="alert" className="text-destructive-muted-foreground">{t('users.add.invalid_email')}</p>
          )}
          {outcome?.kind === 'error' && (
            <p role="alert" className="text-destructive-muted-foreground">{t('users.add.error')}</p>
          )}
          {outcome?.kind === 'member_quota' && (
            <p role="alert" className="text-destructive-muted-foreground">{t('users.add.quota')}</p>
          )}
          {outcome?.kind === 'capability_unavailable' && (
            <p role="alert" className="text-destructive-muted-foreground">{t('tenant.creation.capability_unavailable')}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.close')}</Button>
          <Button type="submit" disabled={busy || !canInvite || !email.trim()}>{t('users.add.submit')}</Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
