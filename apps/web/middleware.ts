import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (!session && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url))
  }
  if (session && pathname.startsWith('/admin') && session.user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url))
  }
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
