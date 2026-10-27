'use client'

import React, { useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'
import { endSupport } from '@/lib/platform/support-actions'
import { loadPage } from './load-page'

/**
 * La fascia dell'assistenza (specifica 2026-10-26, §3.2, MT5-DEC-10, MT5-DEC-11): sempre visibile
 * mentre la piattaforma lavora in un tenant, con il tenant e la scadenza del permesso (il modello
 * non ne ha). «Esci» scrive l'uscita nei due registri e ricalcola la sessione (`endSupport`), poi il
 * browser carica la console da capo. Se l'uscita fallisce si resta qui, con la fascia e l'errore.
 */
export function SupportBanner({ tenantName, until }: { tenantName: string; until: string | null }) {
  const { t, fmt } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleExit = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await endSupport()
    } catch {
      setFailed(true)
      setBusy(false)
      return
    }
    loadPage('/platform')
  }

  const text = until
    ? t('platform.support.banner', { tenant: tenantName, time: fmt.dateTime(until) })
    : t('platform.support.banner_no_end', { tenant: tenantName })

  return (
    <div
      data-testid="support-banner"
      role="region"
      aria-label={text}
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-warning-muted px-8 py-2 text-sm text-warning-muted-foreground"
    >
      <p className="flex min-w-0 items-center gap-2">
        <LifeBuoy size={16} aria-hidden="true" className="shrink-0" />
        <span className="break-words">{text}</span>
      </p>
      <span className="flex items-center gap-3">
        {failed && <span role="alert">{t('platform.support.exit_error')}</span>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleExit()}>{t('platform.support.exit')}</Button>
      </span>
    </div>
  )
}
