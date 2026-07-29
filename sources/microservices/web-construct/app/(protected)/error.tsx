'use client'

import { useEffect } from 'react'
import { useOptionalI18n } from '@/context/I18nContext'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Tolerant read: this boundary must render even when the i18n provider is
  // what failed, so every label has a literal fallback.
  const i18n = useOptionalI18n()
  const t = (key: string, fallback: string) => (i18n ? i18n.t(key) : fallback)

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4">
      <p className="text-sm text-foreground-muted">{t('errors.page_title', 'Something went wrong.')}</p>
      {error.digest && (
        <p className="text-xs text-foreground-faint font-mono">
          {t('errors.error_id', 'Error ID')}: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity"
      >
        {t('errors.retry', 'Try again')}
      </button>
    </div>
  )
}
