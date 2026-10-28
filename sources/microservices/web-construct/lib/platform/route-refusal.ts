import { NextResponse } from 'next/server'
import { isDedicatedHost } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'

/**
 * La risposta di una rotta della console a chi non è amministratore di piattaforma (MT5-DEC-3):
 * 403; su un indirizzo dedicato la console non esiste e la risposta è 404, a chiunque. La rotta
 * l'ha già rifiutato con `requirePlatformAdmin`: qui si sceglie solo il codice.
 */
export async function refuseConsoleRoute(): Promise<NextResponse> {
  if (await isDedicatedHost(await readRequestHost()).catch(() => false)) {
    return NextResponse.json({ error: 'Non trovato.' }, { status: 404 })
  }
  return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
}
