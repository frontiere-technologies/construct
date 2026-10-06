import type { Metadata } from 'next'
import { getI18nBundle } from '@/lib/i18n/server'
import { getAppearance } from '@/lib/appearance-server'
import { getAppTheme } from '@/lib/theme-server'
import { themeCss } from '@/lib/theme-vars'
import { THEME_MODE_SCRIPT } from '@/lib/appearance'
import { Providers } from './Providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Construct application',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved in the root layout so /login, /register and the rest of the public
  // surface are translated and themed too, not just the protected area.
  const [i18n, appearance, theme] = await Promise.all([
    getI18nBundle(), getAppearance(), getAppTheme(),
  ])

  return (
    // suppressHydrationWarning: la classe `dark` la mette THEME_MODE_SCRIPT prima
    // dell'idratazione, quindi su <html> l'HTML del server e il DOM differiscono
    // per costruzione. React non gestisce quella classe (specifica §4).
    <html
      lang={i18n.language.code}
      data-theme-mode={appearance.mode}
      style={{ fontSize: `${appearance.scale}%` }}
      suppressHydrationWarning
    >
      <head>
        <style id="app-primary" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_MODE_SCRIPT }} />
      </head>
      <body>
        <Providers i18n={i18n}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
