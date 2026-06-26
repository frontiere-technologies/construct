import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: { signIn: '/login' },
  callbacks: {
    session({ session, token }) {
      // Map custom JWT fields so middleware's `auth` object includes role/userId/provider
      if (token.role) (session.user as { role?: string }).role = token.role as string
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

      if (!session && !isPublic) {
        return Response.redirect(new URL('/login', nextUrl))
      }
      if (session && isAuthOnlyRedirect) {
        return Response.redirect(new URL('/', nextUrl))
      }
      if (session && pathname.startsWith('/admin') && (session.user as { role?: string })?.role !== 'admin') {
        return Response.redirect(new URL('/', nextUrl))
      }
      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig
