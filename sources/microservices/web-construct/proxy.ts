import type { NextFetchEvent, NextMiddleware, NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { keepOnRequestHost } from '@/lib/auth-host-redirect'

// Next chiama il proxy con (request, event), come faceva con `export default auth`: il tipo
// pubblico di `auth` non elenca questa forma, che però è quella che next-auth gestisce come
// middleware (authorized, poi il rinvio).
const authMiddleware = auth as unknown as NextMiddleware

/**
 * Il middleware di next-auth, con i rinvii di `authorized` riportati sull'indirizzo della
 * richiesta: next-auth li costruisce su AUTH_URL (lib/auth-host-redirect.ts). L'origine è quella
 * che Next attribuisce alla richiesta, così Next stesso accorcia il rinvio in un percorso relativo.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await authMiddleware(request, event)
  return response instanceof Response ? keepOnRequestHost(request, response, request.nextUrl.origin) : response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
