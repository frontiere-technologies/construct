'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'

/** The server repeats authorization before delivery; UI visibility is only a convenience. */
export function TenantDataExport() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const download = async () => {
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch('/api/tenant/export', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('export unavailable')
      const blob = await response.blob()
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'tenant-archive.json'
        link.click()
      } finally { URL.revokeObjectURL(url) }
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      request.current = null
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 space-y-4">
      <h2 className="border-b border-border pb-2 font-medium text-foreground">{t('tenancy.export.title')}</h2>
      <p className="max-w-xl text-sm text-muted-foreground">{t('tenancy.export.hint')}</p>
      <Button variant="outline" disabled={busy} onClick={() => void download()}>
        {t(busy ? 'tenancy.export.preparing' : 'tenancy.export.download')}
      </Button>
      {failed && <p role="alert" className="text-sm text-destructive-muted-foreground">{t('tenancy.export.failed')}</p>}
    </section>
  )
}
