'use client'

import React, { useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/context/I18nContext'
import { addPlatformAdmin, removePlatformAdmin } from '@/lib/platform/platform-admin-actions'
import type { PlatformAdminRow } from '@/lib/platform/platform-admin-service'
import { emailSchema } from '@/lib/rbac/action-input-schemas'

interface Props {
  admins: PlatformAdminRow[]
  /** L'id di chi guarda la pagina: la sua riga si segna. */
  currentUserId: string
}

/**
 * Gli amministratori di piattaforma (specifica 2026-10-26, MT5-DEC-2): l'elenco, "Aggiungi" per
 * email e "Togli" con conferma. Non si può togliere l'ultimo amministratore attivo: il bottone è
 * spento e dice perché, ma chi decide è il server, che lo rifiuta comunque. Un errore del server
 * non si mostra mai: in produzione non arriva, e il testo è sempre quello generico.
 */
export function PlatformAdmins({ admins, currentUserId }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<PlatformAdminRow | null>(null)
  const [removeFailed, setRemoveFailed] = useState(false)
  const hintPrefix = useId()

  const activeCount = admins.filter(admin => admin.active).length

  const confirmRemove = async (admin: PlatformAdminRow) => {
    try {
      await removePlatformAdmin(admin.id)
      setRemoveFailed(false)
      router.refresh()
    } catch {
      setRemoveFailed(true)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" data-testid="add-platform-admin" onClick={() => setAdding(true)}>{t('platform.admins.add.open')}</Button>
      </div>

      {removeFailed && <p role="alert" className="mb-3 text-sm text-destructive-muted-foreground">{t('platform.admins.remove.error')}</p>}

      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-accent text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t('platform.admins.email')}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t('platform.admins.name')}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t('platform.admins.status')}</th>
              <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">{t('common.actions.row_actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {admins.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">{t('platform.admins.empty')}</td></tr>
            )}
            {admins.map(admin => {
              const isLastActive = admin.active && activeCount === 1
              return (
                <tr key={admin.id} className="border-t border-border-subtle">
                  <td className="px-4 py-2 font-medium">
                    {admin.email}
                    {admin.id === currentUserId && (
                      <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-normal text-foreground-secondary">{t('platform.admins.you')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{admin.name ?? ''}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.active ? 'bg-success-muted text-success-muted-foreground' : 'bg-accent text-foreground-secondary'}`}>
                      {admin.active ? t('users.status.active') : t('users.status.deactivated')}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="outline" size="sm" disabled={isLastActive}
                        aria-describedby={isLastActive ? `${hintPrefix}-${admin.id}` : undefined}
                        onClick={() => { setRemoveFailed(false); setRemoving(admin) }}
                      >
                        {t('platform.admins.remove.action')}
                      </Button>
                      {/* Il perché è testo nella pagina: un `title` su un bottone spento non si legge da tastiera né da touch. */}
                      {isLastActive && (
                        <span id={`${hintPrefix}-${admin.id}`} className="max-w-48 text-xs text-muted-foreground">{t('platform.admins.remove.last_hint')}</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {adding && <AddAdminDialog onClose={() => setAdding(false)} onAdded={() => router.refresh()} />}

      {removing && (
        <ConfirmModal
          title={t('platform.admins.remove.title')}
          message={t('platform.admins.remove.message', { email: removing.email })}
          destructive
          confirmLabel={t('platform.admins.remove.confirm')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => confirmRemove(removing)}
        />
      )}
    </div>
  )
}

type Outcome = { kind: 'done' | 'done_invited' | 'done_invite_failed' | 'invalid' | 'error' } | null

/** Il dialogo si monta solo da aperto: riaprendolo, il campo e l'esito ripartono da zero. */
function AddAdminDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const titleId = useId()
  const fieldId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    // Lo stesso schema del server: l'indirizzo scritto male non parte nemmeno.
    if (!emailSchema.safeParse(email).success) { setOutcome({ kind: 'invalid' }); return }
    setBusy(true); setOutcome(null)
    try {
      const result = await addPlatformAdmin(email)
      setOutcome({ kind: result.inviteFailed ? 'done_invite_failed' : result.invited ? 'done_invited' : 'done' })
      // Il campo si svuota: l'esito resta leggibile e lo stesso invio non si ripete per sbaglio.
      setEmail('')
      onAdded()
    } catch {
      setOutcome({ kind: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog titleId={titleId} onClose={onClose} busy={busy} panelClassName="bg-popover rounded-xl p-5 w-full max-w-md">
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="mb-4 text-lg font-semibold">{t('platform.admins.add.title')}</h2>
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.admins.add.email_label')}</label>
        <Input
          id={fieldId} type="email" autoComplete="off" data-dialog-initial-focus value={email}
          onChange={event => { setEmail(event.target.value); setOutcome(null) }}
        />
        <div className="mt-3 min-h-5 text-sm">
          {(outcome?.kind === 'done' || outcome?.kind === 'done_invited') && (
            <p role="status" className="text-foreground">{t(`platform.admins.add.${outcome.kind}`)}</p>
          )}
          {outcome?.kind === 'done_invite_failed' && (
            <p role="alert" className="text-warning-muted-foreground">{t('platform.admins.add.done_invite_failed')}</p>
          )}
          {outcome?.kind === 'invalid' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.admins.add.invalid_email')}</p>}
          {outcome?.kind === 'error' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.admins.add.error')}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.close')}</Button>
          <Button type="submit" disabled={busy || !email.trim()}>{t('platform.admins.add.submit')}</Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
