'use client'

import React, { useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/context/I18nContext'
import {
  addTenantAdmin, addTenantHost, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus,
  type HostActionResult,
} from '@/lib/platform/tenant-actions'
import type { PlatformTenantDetail } from '@/lib/platform/tenant-service'
import type { PlatformTenantStatus } from '@/lib/platform/tenants-grid-query'
import { emailSchema } from '@/lib/rbac/action-input-schemas'
import { TenantStatusBadge } from './TenantStatusBadge'

type Notice = { kind: 'ok' | 'error'; text: string } | null
type StatusChange = 'suspend' | 'reactivate' | 'archive' | 'restore'

const TARGET: Record<StatusChange, PlatformTenantStatus> = {
  suspend: 'suspended', reactivate: 'active', archive: 'archived', restore: 'active',
}
const CHANGES_FROM: Record<PlatformTenantStatus, StatusChange[]> = {
  active: ['suspend', 'archive'],
  suspended: ['reactivate', 'archive'],
  archived: ['restore'],
}

const HOST_ERRORS: Record<'taken' | 'invalid' | 'primary', string> = {
  taken: 'platform.tenant.host.error_taken',
  invalid: 'platform.tenant.host.error_invalid',
  primary: 'platform.tenant.host.error_primary',
}

interface Props {
  tenant: PlatformTenantDetail
}

/**
 * La scheda di un tenant nella console (specifica 2026-10-26, MT5-DEC-6, MT5-DEC-7, MT5-DEC-8,
 * MT5-DEC-9, MT5-DEC-25): i dati e lo stato con i suoi cambi, gli indirizzi, gli amministratori. Ogni
 * cambio chiede una conferma, l'archiviazione anche un motivo scritto; il ripristino dall'archivio
 * passa al server la conferma esplicita. Un errore del server non si mostra mai: in produzione non
 * arriva e il testo è sempre quello generico (i rifiuti previsti hanno il loro messaggio, perché le
 * azioni li restituiscono come risultato). Chi decide è il server: i bottoni spenti dicono solo
 * perché. Le sezioni di assistenza e degli eventi della piattaforma arrivano con i Task 9 e 10.
 */
export function TenantDetail({ tenant }: Props) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [notice, setNotice] = useState<Notice>(null)
  const [statusChange, setStatusChange] = useState<StatusChange | null>(null)
  const [addingHost, setAddingHost] = useState(false)
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [hostToMakePrimary, setHostToMakePrimary] = useState<string | null>(null)
  const [hostToRemove, setHostToRemove] = useState<string | null>(null)
  const hintId = useId()

  const fixed = tenant.isTemplate || tenant.isDefault
  const takesPeople = !tenant.isTemplate && tenant.status === 'active'
  const done = () => router.refresh()

  /** L'esito di un'azione sugli indirizzi: aggiorna la pagina, o spiega il rifiuto. */
  const reportHost = (result: HostActionResult) => {
    if (result.ok) { setNotice(null); done(); return }
    setNotice({ kind: 'error', text: t(HOST_ERRORS[result.reason]) })
  }

  const runHostAction = async (action: () => Promise<HostActionResult>, close: () => void) => {
    try { reportHost(await action()) } catch { setNotice({ kind: 'error', text: t('platform.tenant.host.error') }) } finally { close() }
  }

  const resend = async (userId: string) => {
    setNotice(null)
    try {
      const result = await resendTenantInvite(tenant.id, userId)
      if (result.inviteFailed) setNotice({ kind: 'error', text: t('platform.tenant.admin.done_invite_failed') })
      else setNotice({ kind: 'ok', text: t(result.invited ? 'platform.tenant.admin.resent' : 'platform.tenant.admin.done') })
      done()
    } catch {
      setNotice({ kind: 'error', text: t('platform.tenant.admin.error') })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div><Link href="/platform" className="text-sm text-primary underline-offset-4 hover:underline">{t('platform.tenant.detail.back')}</Link></div>

      {notice?.kind === 'error' && <p role="alert" className="text-sm text-destructive-muted-foreground">{notice.text}</p>}
      {notice?.kind === 'ok' && <p role="status" className="text-sm text-foreground">{notice.text}</p>}

      <section aria-labelledby={`${hintId}-data`} className="rounded-lg border border-border-subtle p-4">
        <h2 id={`${hintId}-data`} className="mb-3 text-base font-semibold">{t('platform.tenant.detail.data')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('platform.tenants.name')}</dt><dd className="font-medium">{tenant.name}</dd>
          <dt className="text-muted-foreground">{t('platform.tenants.slug')}</dt><dd>{tenant.slug}</dd>
          <dt className="text-muted-foreground">{t('platform.tenants.status')}</dt><dd><TenantStatusBadge status={tenant.status} /></dd>
          <dt className="text-muted-foreground">{t('platform.tenants.created_at')}</dt><dd>{fmt.date(tenant.createdAt)}</dd>
        </dl>
        {fixed ? (
          <p className="mt-4 text-sm text-muted-foreground">{t('platform.tenant.detail.fixed_hint')}</p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {CHANGES_FROM[tenant.status].map(change => (
              <Button key={change} size="sm" variant={change === 'archive' ? 'destructive' : 'outline'} onClick={() => { setNotice(null); setStatusChange(change) }}>
                {t(`platform.tenant.status.${change}`)}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby={`${hintId}-hosts`} className="rounded-lg border border-border-subtle p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={`${hintId}-hosts`} className="text-base font-semibold">{t('platform.tenant.detail.hosts')}</h2>
          {!fixed && <Button size="sm" onClick={() => { setNotice(null); setAddingHost(true) }}>{t('platform.tenant.host.add')}</Button>}
        </div>
        {fixed && <p className="text-sm text-muted-foreground">{t('platform.tenant.detail.template_hint')}</p>}
        {!fixed && tenant.hosts.length === 0 && <p className="text-sm text-muted-foreground">{t('platform.tenant.host.empty')}</p>}
        <ul className="flex flex-col gap-2">
          {tenant.hosts.map(host => (
            <li key={host.host} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{host.host}</span>
                {host.isPrimary && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-foreground-secondary">{t('platform.tenant.host.primary')}</span>}
              </span>
              <span className="flex gap-2">
                {!host.isPrimary && <Button variant="outline" size="sm" onClick={() => { setNotice(null); setHostToMakePrimary(host.host) }}>{t('platform.tenant.host.make_primary')}</Button>}
                <Button variant="outline" size="sm" onClick={() => { setNotice(null); setHostToRemove(host.host) }}>{t('platform.tenant.host.remove')}</Button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${hintId}-admins`} className="rounded-lg border border-border-subtle p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={`${hintId}-admins`} className="text-base font-semibold">{t('platform.tenant.detail.admins')}</h2>
          {!tenant.isTemplate && (
            <Button size="sm" disabled={!takesPeople} aria-describedby={takesPeople ? undefined : hintId} onClick={() => { setNotice(null); setAddingAdmin(true) }}>
              {t('platform.tenant.admin.add')}
            </Button>
          )}
        </div>
        {/* Il perché dei bottoni spenti è testo nella pagina: un `title` su un bottone spento non si legge da tastiera né da touch. */}
        {!tenant.isTemplate && !takesPeople && <p id={hintId} className="mb-3 text-sm text-muted-foreground">{t('platform.tenant.detail.inactive_hint')}</p>}
        {tenant.isTemplate && <p className="text-sm text-muted-foreground">{t('platform.tenant.detail.template_hint')}</p>}
        {!tenant.isTemplate && tenant.admins.length === 0 && <p className="text-sm text-muted-foreground">{t('platform.tenant.admin.empty')}</p>}
        <ul className="flex flex-col gap-2">
          {tenant.admins.map(admin => (
            <li key={admin.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{admin.email}</span>
                {!admin.hasPassword && <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning-muted-foreground">{t('platform.tenant.admin.pending')}</span>}
              </span>
              {!admin.hasPassword && (
                <Button variant="outline" size="sm" disabled={!takesPeople} aria-describedby={takesPeople ? undefined : hintId} onClick={() => void resend(admin.userId)}>
                  {t('platform.tenant.admin.resend')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {statusChange && (
        <StatusDialog
          tenant={tenant} change={statusChange} onClose={() => setStatusChange(null)}
          onDone={() => { setStatusChange(null); done() }}
          onFailed={() => { setStatusChange(null); setNotice({ kind: 'error', text: t('platform.tenant.status.error') }) }}
        />
      )}
      {addingHost && <AddHostDialog tenantId={tenant.id} onClose={() => setAddingHost(false)} onAdded={done} />}
      {addingAdmin && <AddAdminDialog tenantId={tenant.id} onClose={() => setAddingAdmin(false)} onAdded={done} />}
      {hostToMakePrimary && (
        <ConfirmModal
          title={t('platform.tenant.host.make_primary_title')}
          message={t('platform.tenant.host.make_primary_message', { host: hostToMakePrimary })}
          onCancel={() => setHostToMakePrimary(null)}
          onConfirm={() => runHostAction(() => setPrimaryHost(tenant.id, hostToMakePrimary), () => setHostToMakePrimary(null))}
        />
      )}
      {hostToRemove && (
        <ConfirmModal
          title={t('platform.tenant.host.remove_title')}
          message={t('platform.tenant.host.remove_message', { host: hostToRemove })}
          destructive
          onCancel={() => setHostToRemove(null)}
          onConfirm={() => runHostAction(() => removeTenantHost(tenant.id, hostToRemove), () => setHostToRemove(null))}
        />
      )}
    </div>
  )
}

interface StatusDialogProps {
  tenant: PlatformTenantDetail
  change: StatusChange
  onClose: () => void
  onDone: () => void
  onFailed: () => void
}

/** La conferma di un cambio di stato; l'archiviazione chiede anche il motivo, che finisce nel registro (MT5-DEC-9). */
function StatusDialog({ tenant, change, onClose, onDone, onFailed }: StatusDialogProps) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  const [missingReason, setMissingReason] = useState(false)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const reasonId = useId()
  const needsReason = change === 'archive'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmed = reason.trim()
    if (needsReason && !trimmed) { setMissingReason(true); return }
    setBusy(true)
    try {
      if (change === 'archive') await setTenantStatus(tenant.id, TARGET[change], trimmed)
      else if (change === 'restore') await setTenantStatus(tenant.id, TARGET[change], undefined, true)
      else await setTenantStatus(tenant.id, TARGET[change])
      onDone()
    } catch {
      onFailed()
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog titleId={titleId} onClose={onClose} busy={busy} panelClassName="bg-popover rounded-xl p-6 w-full max-w-md shadow-xl">
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="mb-2 text-lg font-bold">{t(`platform.tenant.status.${change}_title`)}</h2>
        <p className="mb-4 break-words text-sm text-muted-foreground">{t(`platform.tenant.status.${change}_message`, { name: tenant.name })}</p>
        {needsReason && (
          <div className="mb-4">
            <label htmlFor={reasonId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.status.reason')}</label>
            <Textarea
              id={reasonId} data-dialog-initial-focus rows={3} maxLength={500} value={reason}
              onChange={event => { setReason(event.target.value); setMissingReason(false) }}
            />
            {missingReason && <p role="alert" className="mt-1 text-sm text-destructive-muted-foreground">{t('platform.tenant.status.reason_required')}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" data-dialog-close data-dialog-initial-focus={needsReason ? undefined : true} onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button type="submit" variant={change === 'archive' ? 'destructive' : 'default'} disabled={busy}>{t(`platform.tenant.status.${change}`)}</Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

/** Il dialogo si monta solo da aperto: riaprendolo, i campi e l'esito ripartono da zero. */
function AddHostDialog({ tenantId, onClose, onAdded }: { tenantId: number; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n()
  const [host, setHost] = useState('')
  const [primary, setPrimary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const fieldId = useId()
  const primaryId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !host.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await addTenantHost(tenantId, host.trim(), primary)
      if (!result.ok) { setError(t(HOST_ERRORS[result.reason])); return }
      onAdded(); onClose()
    } catch {
      setError(t('platform.tenant.host.error'))
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog titleId={titleId} onClose={onClose} busy={busy} panelClassName="bg-popover rounded-xl p-5 w-full max-w-md">
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="mb-4 text-lg font-semibold">{t('platform.tenant.host.add_title')}</h2>
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.host.label')}</label>
        <Input id={fieldId} autoComplete="off" data-dialog-initial-focus value={host} onChange={event => { setHost(event.target.value); setError(null) }} />
        <label htmlFor={primaryId} className="mt-3 flex items-center gap-2 text-sm">
          <input id={primaryId} type="checkbox" checked={primary} onChange={event => setPrimary(event.target.checked)} />
          {t('platform.tenant.host.make_primary_option')}
        </label>
        <div className="mt-3 min-h-5 text-sm">{error && <p role="alert" className="text-destructive-muted-foreground">{error}</p>}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button type="submit" disabled={busy || !host.trim()}>{t('platform.tenant.host.add')}</Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

type AdminOutcome = 'done' | 'done_invited' | 'done_invite_failed' | 'invalid' | 'error' | null

function AddAdminDialog({ tenantId, onClose, onAdded }: { tenantId: number; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<AdminOutcome>(null)
  const titleId = useId()
  const fieldId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    // Lo stesso schema del server: l'indirizzo scritto male non parte nemmeno.
    if (!emailSchema.safeParse(email).success) { setOutcome('invalid'); return }
    setBusy(true); setOutcome(null)
    try {
      const result = await addTenantAdmin(tenantId, email)
      setOutcome(result.inviteFailed ? 'done_invite_failed' : result.invited ? 'done_invited' : 'done')
      // Il campo si svuota: l'esito resta leggibile e lo stesso invio non si ripete per sbaglio.
      setEmail('')
      onAdded()
    } catch {
      setOutcome('error')
    } finally { setBusy(false) }
  }

  return (
    <AccessibleDialog titleId={titleId} onClose={onClose} busy={busy} panelClassName="bg-popover rounded-xl p-5 w-full max-w-md">
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="mb-4 text-lg font-semibold">{t('platform.tenant.admin.add_title')}</h2>
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted-foreground">{t('platform.tenant.admin.email_label')}</label>
        <Input
          id={fieldId} type="email" autoComplete="off" data-dialog-initial-focus value={email}
          onChange={event => { setEmail(event.target.value); setOutcome(null) }}
        />
        <div className="mt-3 min-h-5 text-sm">
          {(outcome === 'done' || outcome === 'done_invited') && <p role="status" className="text-foreground">{t(`platform.tenant.admin.${outcome}`)}</p>}
          {outcome === 'done_invite_failed' && <p role="alert" className="text-warning-muted-foreground">{t('platform.tenant.admin.done_invite_failed')}</p>}
          {outcome === 'invalid' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.admins.add.invalid_email')}</p>}
          {outcome === 'error' && <p role="alert" className="text-destructive-muted-foreground">{t('platform.tenant.admin.error')}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" data-dialog-close onClick={onClose}>{t('common.actions.close')}</Button>
          <Button type="submit" disabled={busy || !email.trim()}>{t('platform.tenant.admin.add_submit')}</Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
