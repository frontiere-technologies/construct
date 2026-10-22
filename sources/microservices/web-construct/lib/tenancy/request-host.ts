import { headers } from 'next/headers'

// Un nome di host: etichette di lettere, cifre e trattini separate da punti.
const HOST_NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/
// Un indirizzo IPv6 fra parentesi quadre, con la porta facoltativa.
const BRACKETED_IPV6_RE = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/
const MAX_HOST_LENGTH = 253

/**
 * La forma con cui un indirizzo si confronta e si salva: minuscolo, senza porta e senza punto
 * finale (`A.Localhost:3000` → `a.localhost`, `[::1]:3000` → `::1`). `null` se il valore è
 * vuoto o non è un indirizzo: spazi, barre, credenziali o una porta non numerica.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return null

  const ipv6 = BRACKETED_IPV6_RE.exec(value)
  if (ipv6) return ipv6[1]

  const portAt = value.lastIndexOf(':')
  if (portAt !== -1 && !/^\d{1,5}$/.test(value.slice(portAt + 1))) return null
  const name = (portAt === -1 ? value : value.slice(0, portAt)).replace(/\.$/, '')
  if (!name || name.length > MAX_HOST_LENGTH || !HOST_NAME_RE.test(name)) return null
  return name
}

/**
 * L'indirizzo dalle intestazioni di una richiesta. `x-forwarded-host` conta solo se
 * `TRUST_FORWARDED_HOST` è `true`, cioè quando davanti all'app c'è un proxy che la scrive lui:
 * altrimenti chiunque potrebbe sceglierla. Se arriva un elenco vale l'ultimo valore, quello che ha
 * aggiunto il proxy fidato: i valori prima li ha scritti chi stava davanti a lui, client compreso.
 * Se non è valido si ricade sull'intestazione `host`.
 */
export function hostFromHeaders(requestHeaders: Headers): string | null {
  if (process.env.TRUST_FORWARDED_HOST === 'true') {
    const forwarded = normalizeHost(requestHeaders.get('x-forwarded-host')?.split(',').at(-1))
    if (forwarded) return forwarded
  }
  return normalizeHost(requestHeaders.get('host'))
}

/**
 * L'indirizzo della richiesta corrente, nella forma di `normalizeHost`. Decide solo quali tenant
 * sono possibili, confrontato con il registro: non entra mai in un link (MT4-DEC-12).
 */
export async function readRequestHost(): Promise<string | null> {
  return hostFromHeaders(await headers())
}
