import type { Metadata } from 'next'
import { getI18nBundle } from '@/lib/i18n/server'
import { Providers } from './Providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Construct application',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved in the root layout so /login, /register and the rest of the public
  // surface are translated too, not just the protected area.
  const i18n = await getI18nBundle()

  return (
    <html lang={i18n.language.code}>
      <body>
        <Providers i18n={i18n}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
