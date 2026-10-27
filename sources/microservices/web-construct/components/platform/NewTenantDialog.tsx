'use client'

import React, { useId, useState, type FormEvent } from 'react'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/context/I18nContext'
import { createTenantInputSchema } from '@/lib/platform/tenant-action-schemas'
import { createTenant } from '@/lib/platform/tenant-actions'
import { suggestSlug } from '@/lib/platform/tenant-slug'

interface Props {
  onClose: () => void
  /** Il tenant è stato creato: la pagina si aggiorna. */
  onCreated: (tenantId: number) => void
}

type Outcome = { kind: 'invited' | 'existing' | 'invite_failed' | 'taken' | 'invalid_host' | 'invalid' | 'error' } | null

/**
 * Il modulo "Nuovo tenant" (specifica 2026-10-26, MT5-DEC-5): nome, slug (proposto dal nome finché
 * la persona non ne scrive uno), indirizzo dedicato facoltativo, email del primo amministratore. Lo
 * stesso schema del server controlla i campi prima di partire. Un errore del server non si mostra
 * mai: in produzione non arriva, e il testo è quello generico; slug o indirizzo già presi hanno il
 * loro messaggio, perché l'azione li restituisce come risultato. Dopo la creazione il modulo sparisce
 * e resta l'esito: il tenant non si crea due volte.
 */
export function NewTenantDialog({ onClose, onCreated }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [host, setHost] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const titleId = useId()
  const nameId = useId()
  const slugId = useId()
  const slugHintId = useId()
  const hostId = useId()
  const hostHintId = useId()
  const emailId = useId()

  const created = outcome?.kind === 'invited' || outcome?.kind === 'existing' || outcome?.kind === 'invite_failed'

  const changeName = (value: string) => {
    setName(value)
    if (!slugEdited) setSlug(suggestSlug(value))
    setOutcome(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const input = { name, slug, ...(host.trim() ? { host: host.trim() } : {}), adminEmail }
    if (!createTenantInputSchema.safeParse(input).success) { setOutcome({ kind: 'invalid' }); return }
    setBusy(true); setOutcome(null)
    try {
      const result = await createTenant(input)
      if (!result.ok) { setOutcome({ kind: result.reason }); return }
      setOutcome({ kind: result.inviteFailed ? 'invite_failed' : result.invited ? 'invited' : 'existing' })
      onCreated(result.tenantId)
    } catch {
      setOutcome({ kind: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog titleId={titleId} onClose={onClose} busy={busy} panelClassName="bg-popover rounded-xl p-5 w-full max-w-md">
      <h2 id={titleId} className="mb-4 text-lg font-semibold">{t('platform.tenant.new.title')}</h2>
      {!created && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.new.name')}</label>
            <Input id={nameId} autoComplete="off" data-dialog-initial-focus value={name} onChange={event => changeName(event.target.value)} />
          </div>
          <div>
            <label htmlFor={slugId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.new.slug')}</label>
            <Input
              id={slugId} autoComplete="off" aria-describedby={slugHintId} value={slug}
              onChange={event => { setSlug(event.target.value); setSlugEdited(true); setOutcome(null) }}
            />
            <p id={slugHintId} className="mt-1 text-xs text-muted-foreground">{t('platform.tenant.new.slug_hint')}</p>
          </div>
          <div>
            <label htmlFor={hostId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.new.host')}</label>
            <Input id={hostId} autoComplete="off" aria-describedby={hostHintId} value={host} onChange={event => { setHost(event.target.value); setOutcome(null) }} />
            <p id={hostHintId} className="mt-1 text-xs text-muted-foreground">{t('platform.tenant.new.host_hint')}</p>
          </div>
          <div>
            <label htmlFor={emailId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.new.admin_email')}</label>
            <Input id={emailId} type="email" autoComplete="off" value={adminEmail} onChange={event => { setAdminEmail(event.target.value); setOutcome(null) }} />
          </div>
          <div className="min-h-5 text-sm">
            {outcome?.kind === 'invalid' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.tenant.new.invalid')}</p>}
            {outcome?.kind === 'taken' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.tenant.new.error_taken')}</p>}
            {outcome?.kind === 'invalid_host' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.tenant.new.host_invalid')}</p>}
            {outcome?.kind === 'error' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.tenant.new.error')}</p>}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('platform.tenant.new.submit')}</Button>
          </div>
        </form>
      )}
      {created && (
        <div>
          {outcome?.kind === 'invite_failed'
            ? <p role="alert" className="text-warning-muted-foreground">{t('platform.tenant.new.done_invite_failed')}</p>
            : <p role="status" className="text-foreground">{t(outcome?.kind === 'invited' ? 'platform.tenant.new.done_invited' : 'platform.tenant.new.done_existing')}</p>}
          <div className="mt-5 flex justify-end">
            <Button type="button" data-dialog-initial-focus data-dialog-close onClick={onClose}>{t('common.actions.close')}</Button>
          </div>
        </div>
      )}
    </AccessibleDialog>
  )
}
