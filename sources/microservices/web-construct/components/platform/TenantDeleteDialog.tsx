'use client'

import { useId, useState, type FormEvent } from 'react'
import { AccessibleDialog } from '@/components/shared/AccessibleDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/context/I18nContext'
import { deleteTenantPermanently } from '@/lib/platform/tenant-delete-actions'

interface Props {
  tenantId: number
  slug: string
  onClose: () => void
  onDeleted: () => void
}

export function TenantDeleteDialog({ tenantId, slug, onClose, onDeleted }: Props) {
  const { t } = useI18n()
  const titleId = useId()
  const warningId = useId()
  const inputId = useId()
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || confirmation !== slug) return
    setBusy(true)
    setError(null)
    try {
      const result = await deleteTenantPermanently(tenantId, confirmation)
      if (result.ok) {
        onDeleted()
        return
      }
      setError(t(`platform.tenant.delete.${result.reason}`))
    } catch {
      setError(t('platform.tenant.delete.error'))
    }
    setBusy(false)
  }

  return (
    <AccessibleDialog titleId={titleId} descriptionId={warningId} onClose={onClose} busy={busy}
      panelClassName="w-full max-w-md rounded-xl bg-popover p-6 shadow-xl">
      <form onSubmit={handleSubmit}>
        <h2 id={titleId} className="mb-2 text-lg font-semibold">{t('platform.tenant.delete.title')}</h2>
        <p id={warningId} className="mb-4 text-sm text-muted-foreground">{t('platform.tenant.delete.warning')}</p>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium">{t('platform.tenant.delete.slug')}{' '}
          <code>{slug}</code>
        </label>
        <Input id={inputId} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={40}
          data-dialog-initial-focus value={confirmation} readOnly={busy}
          onChange={event => { setConfirmation(event.target.value); setError(null) }} />
        {error && <p role="alert" className="mt-2 text-sm text-destructive-muted-foreground">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" data-dialog-close disabled={busy} onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || confirmation !== slug}>
            {t(busy ? 'platform.tenant.delete.working' : 'platform.tenant.delete.open')}
          </Button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
