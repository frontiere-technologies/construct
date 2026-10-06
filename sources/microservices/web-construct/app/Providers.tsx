'use client'

import { SessionProvider } from 'next-auth/react'
import { I18nProvider } from '@/context/I18nContext'
import { AppHydrationMarker } from '@/components/AppHydrationMarker'
import type { I18nBundle } from '@/lib/i18n/server'

export function Providers({ i18n, children }: { i18n: I18nBundle; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider bundle={i18n}>
        <AppHydrationMarker />
        {children}
      </I18nProvider>
    </SessionProvider>
  )
}
