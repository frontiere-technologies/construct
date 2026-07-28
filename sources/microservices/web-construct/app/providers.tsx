'use client'

import { SessionProvider } from 'next-auth/react'
import { UIProvider } from '@/context/UIContext'
import { I18nProvider } from '@/context/I18nContext'
import type { I18nBundle } from '@/lib/i18n/server'

export function Providers({ i18n, children }: { i18n: I18nBundle; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider bundle={i18n}>
        <UIProvider>
          {children}
        </UIProvider>
      </I18nProvider>
    </SessionProvider>
  )
}
