'use client'

import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'

export function EmbeddedFrame({ url }: { url: string }) {
  const [loading, setLoading] = useState(true)
  const { t } = useI18n()

  return (
    <div className="relative h-full w-full min-h-[600px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <iframe
        src={url}
        title={t('embedded.loading')}
        data-testid="embedded-iframe"
        onLoad={() => setLoading(false)}
        className="h-full w-full min-h-[600px] border-0"
      />
    </div>
  )
}
