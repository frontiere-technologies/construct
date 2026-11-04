'use client'

import { useId, useState } from 'react'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'
import { previewTenantGrantPurge, purgeTenantGrants } from '@/lib/platform/tenant-policy-actions'
import type { PurgePreview } from '@/lib/platform/tenant-policy-schemas'

/** Una nuova anteprima richiede sempre un nuovo click di conferma. */
export function TenantGrantPurgeDialog({ tenantId, preview, onComplete }: { tenantId: number; preview: PurgePreview; onComplete: () => void }) {
  const { t } = useI18n()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(preview)
  const [busy, setBusy] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleConfirm = async () => {
    if (busy || isStale) return
    setBusy(true)
    setError(null)
    try {
      const result = await purgeTenantGrants(tenantId, current)
      if (result.ok) { setOpen(false); onComplete() }
      else { setError(t(`platform.policy.${result.reason}`)); setIsStale(result.reason === 'conflict') }
    } catch { setError(t('platform.policy.error')); setIsStale(true) }
    finally { setBusy(false) }
  }
  const handleRefresh = async () => {
    setBusy(true)
    try { setCurrent(await previewTenantGrantPurge(tenantId, current.keys)); setIsStale(false); setError(null) }
    catch { setError(t('platform.policy.purge.refresh_error')) }
    finally { setBusy(false) }
  }
  return <>
    <Button type="button" variant="destructive" onClick={() => setOpen(true)}>{t('platform.policy.purge.open')}</Button>
    {open && <AccessibleDialog titleId={titleId} onClose={() => setOpen(false)} busy={busy} panelClassName="w-full max-w-lg rounded-xl bg-popover p-6 shadow-xl">
      <h2 id={titleId} className="text-lg font-semibold">{t('platform.policy.purge.title')}</h2>
      <p className="mt-3 text-sm">{t('platform.policy.purge.warning')}</p>
      <ul className="my-3 list-disc pl-5 text-sm">{current.keys.map(key => <li key={key}>{t(`platform.policy.feature.${key.replaceAll('-', '_')}`)}</li>)}</ul>
      <p className="text-sm">{t('platform.policy.purge.counts', { roles: current.roleCount, permissions: current.permissionGrantCount, menus: current.menuGrantCount })}</p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive-muted-foreground">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" data-dialog-close data-dialog-initial-focus onClick={() => setOpen(false)}>{t('common.actions.cancel')}</Button>
        {isStale && <Button type="button" variant="outline" disabled={busy} onClick={handleRefresh}>{t('platform.policy.purge.refresh')}</Button>}
        <Button type="button" variant="destructive" disabled={busy || isStale} onClick={handleConfirm}>{t('platform.policy.purge.confirm')}</Button>
      </div>
    </AccessibleDialog>}
  </>
}
