import type { NextAuthConfig } from 'next-auth'

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
      if (isAuthenticated && isAuthOnlyRedirect) {
        return Response.redirect(new URL('/', nextUrl))
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
