import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { listTenantsForPlatform } from '@/lib/platform/tenant-service'
import { tenantsGridQuerySchema } from '@/lib/platform/tenants-grid-query-schema'
import { isDedicatedHost } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'

const log = createLogger('platform-tenants-grid')

/**
 * La griglia dei tenant della console (specifica 2026-10-26, MT5-DEC-3, MT5-DEC-4). Chi non è
 * amministratore di piattaforma riceve 403; su un indirizzo dedicato la console non esiste e la
 * risposta è 404, a chiunque. Il controllo viene prima di leggere il corpo.
 */
export async function POST(req: NextRequest) {
  const admin = await requirePlatformAdmin().catch(deniedActor)
  if (!admin) {
    // Un indirizzo dedicato rifiuta come un indirizzo che non c'è, non come un divieto.
    if (await isDedicatedHost(await readRequestHost()).catch(() => false)) {
      return NextResponse.json({ error: 'Non trovato.' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = tenantsGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listTenantsForPlatform(parsed.data))
  } catch (err) {
    log.error({ err }, 'failed to list the tenants')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
}
