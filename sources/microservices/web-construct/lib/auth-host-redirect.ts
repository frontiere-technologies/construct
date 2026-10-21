/**
 * Auth.js e più indirizzi (multi-tenancy, pezzo 4, MT4-RISK-1).
 *
 * Quando `AUTH_URL` è impostata, next-auth sostituisce l'origine di ogni richiesta con quella di
 * `AUTH_URL` (`reqWithEnvURL` in `next-auth/lib/env.js`), con o senza `trustHost`: gli indirizzi
 * che restituisce (il ritorno dopo l'accesso, l'uscita, la pagina d'errore, i rinvii del proxy)
 * puntano quindi all'indirizzo configurato, e chi entra da `a.localhost` finirebbe su
 * `localhost`. `AUTH_URL` però deve restare: costruisce i link nelle email (MT4-DEC-12).
 *
 * Qui quegli indirizzi tornano sull'indirizzo della richiesta senza leggerne l'intestazione `Host`:
 * diventano relativi (il browser li risolve sull'indirizzo da cui è partito) oppure, dove serve un
 * indirizzo assoluto, prendono l'origine che Next stesso attribuisce alla richiesta. Un indirizzo
 * verso un'altra origine (Google, per esempio) resta com'è.
 */

/** L'origine di `AUTH_URL` (o del vecchio `NEXTAUTH_URL`), la stessa che usa next-auth. */
function configuredAuthOrigin(): string | null {
  const url = process.env.AUTH_URL || process.env.NEXTAUTH_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * `url` con l'origine di `AUTH_URL` sostituita da `requestOrigin` (vuota: indirizzo relativo).
 * Un indirizzo relativo o di un'altra origine resta com'è.
 */
export function relocateAuthUrl(url: string, authOrigin: string | null, requestOrigin = ''): string {
  if (!authOrigin) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.origin !== authOrigin) return url
  // Una sola barra iniziale: `//evil.example` come indirizzo relativo porterebbe a un altro sito.
  const path = parsed.pathname.replace(/^\/+/, '/')
  return `${requestOrigin}${path}${parsed.search}${parsed.hash}`
}

/**
 * La risposta di Auth.js con i suoi indirizzi riportati sull'indirizzo della richiesta: il rinvio
 * (`Location`) e, quando il client l'ha chiesto con `X-Auth-Return-Redirect` (lo fanno `signIn` e
 * `signOut` di `next-auth/react`), il campo `url` del JSON. I cookie restano tutti.
 */
export async function keepOnRequestHost(request: Request, response: Response, requestOrigin = ''): Promise<Response> {
  const authOrigin = configuredAuthOrigin()
  if (!authOrigin) return response

  // Auth.js risponde a X-Auth-Return-Redirect con il JSON e con le intestazioni del rinvio,
  // Location compresa: vanno riportati tutti e due.
  const location = response.headers.get('location')
  const relocatedLocation = location === null ? null : relocateAuthUrl(location, authOrigin, requestOrigin)
  const body = await redirectAnswer(request, response)
  const relocatedUrl = body === null ? null : relocateAuthUrl(body.url, authOrigin, requestOrigin)
  if (relocatedLocation === location && relocatedUrl === (body?.url ?? null)) return response

  const headers = new Headers(response.headers)
  if (relocatedLocation !== null) headers.set('location', relocatedLocation)
  const init = { status: response.status, statusText: response.statusText, headers }
  if (body === null || relocatedUrl === null) return new Response(response.body, init)
  headers.delete('content-length')
  return Response.json({ ...body, url: relocatedUrl }, init)
}

/** Il JSON `{ url }` con cui Auth.js risponde a chi ha chiesto X-Auth-Return-Redirect, se c'è. */
async function redirectAnswer(request: Request, response: Response): Promise<{ url: string } | null> {
  if (!request.headers.has('x-auth-return-redirect')) return null
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  const body: unknown = await response.clone().json().catch(() => null)
  if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string') return null
  return { ...body, url: body.url }
}
