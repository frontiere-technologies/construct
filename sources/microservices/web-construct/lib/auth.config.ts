import type { NextAuthConfig } from 'next-auth'

/** Le pagine di chi ha fatto l'accesso senza un tenant scelto: la scelta e il messaggio. */
const TENANT_STATE_PAGES = ['/select-tenant', '/no-tenant']

/**
 * Dove sta di casa una sessione secondo lo stato del tenant: `choose` → la pagina di scelta,
 * `none` → il messaggio "Non sei configurato su questo indirizzo", `ready` → la home. Uno stato
 * mancante o sconosciuto vale `none`, come nel callback `session`: mai un tenant per difetto.
 */
function homeOfTenantState(tenantState: unknown): '/' | '/select-tenant' | '/no-tenant' {
  if (tenantState === 'ready') return '/'
  if (tenantState === 'choose') return '/select-tenant'
  return '/no-tenant'
}

export const authConfig = {
  pages: { signIn: '/login' },
  callbacks: {
    session({ session, token }) {
      if (token.roleIds) (session.user as { roleIds?: number[] }).roleIds = token.roleIds as number[]
      if (typeof token.accountActive !== 'undefined') (session.user as { accountActive?: boolean }).accountActive = Boolean(token.accountActive)
      if (token.userId) (session.user as { id?: string }).id = token.userId as string
      if (token.provider) (session.user as { provider?: string }).provider = token.provider as string
      return session
    },
    authorized({ auth, request: { nextUrl } }) {
      const session = auth
      const pathname = nextUrl.pathname

      const PUBLIC_PATHS = ['/login', '/set-password', '/forgot-password', '/register']
      const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))

      // Authenticated users can still access /set-password (invite links work even when logged in)
      const AUTH_ONLY_REDIRECT = ['/login', '/forgot-password', '/register']
      const isAuthOnlyRedirect = AUTH_ONLY_REDIRECT.some(p => pathname === p || pathname.startsWith(p + '/'))

      const isAuthenticated = Boolean(session?.user && (session.user as { accountActive?: boolean }).accountActive)

      if (!isAuthenticated && !isPublic) {
        return Response.redirect(new URL('/login', nextUrl))
      }
      if (!isAuthenticated) return true

      // Il percorso secondo lo stato del tenant nel token (pezzo 4, §3.1, §3.2, MT4-DEC-3,
      // MT4-DEC-4), senza leggere il database: il token l'ha già rivalidato il callback jwt. Chi
      // deve scegliere vede solo la pagina di scelta, chi non ha tenant sull'indirizzo solo il
      // messaggio; con un tenant scelto le due pagine riportano alla home. /set-password resta
      // aperta in ogni stato, come oggi (il link d'invito funziona anche con una sessione aperta).
      const home = homeOfTenantState((session?.user as { tenantState?: unknown }).tenantState)
      const tenantPage = TENANT_STATE_PAGES.find(p => pathname === p || pathname.startsWith(p + '/'))
      if (isAuthOnlyRedirect) {
        return Response.redirect(new URL(home, nextUrl))
      }
      const isOutOfPlace = home === '/'
        ? tenantPage !== undefined
        : tenantPage !== home && !isPublic
      if (isOutOfPlace) {
        return Response.redirect(new URL(home, nextUrl))
      }
      // Nessun elenco di percorsi amministrativi qui: il middleware non legge il database, quindi
      // non può sapere se chi ha `read-menu` può aprire /functionalities. Lo decide la pagina con
      // requirePagePermission (DEC-27 del piano 2026-10-12, HOLE-2).
      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig

export function mergeAuthCallbacks(
  overrides: NonNullable<NextAuthConfig['callbacks']>,
): NonNullable<NextAuthConfig['callbacks']> {
  return { ...authConfig.callbacks, ...overrides }
}
