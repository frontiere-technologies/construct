import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const session = auth
      const pathname = nextUrl.pathname

      if (!session && pathname !== '/login' && !pathname.startsWith('/set-password') && !pathname.startsWith('/forgot-password')) {
        return Response.redirect(new URL('/login', nextUrl))
      }
      if (session && pathname === '/login') {
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
