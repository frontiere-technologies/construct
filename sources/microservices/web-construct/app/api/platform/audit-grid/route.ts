import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { listPlatformAudit, listTemplateAudit } from '@/lib/platform/audit-service'
import { platformAuditGridQuerySchema } from '@/lib/platform/audit-grid-query-schema'
import { refuseConsoleRoute } from '@/lib/platform/route-refusal'

const log = createLogger('platform-audit-grid')

/**
 * La griglia del registro della console (specifica 2026-10-26, MT5-DEC-16, MT5-DEC-21). Legge solo
 * il registro della piattaforma; con `scope: 'template'` (la scheda del modello) legge il registro
 * di tenant del modello, e nessun altro. Chi non è amministratore di piattaforma riceve 403, un
 * indirizzo dedicato 404; il controllo viene prima di leggere il corpo.
 */
export async function POST(req: NextRequest) {
  const admin = await requirePlatformAdmin().catch(deniedActor)
  if (!admin) return refuseConsoleRoute()

  const body = await req.json().catch(() => null)
  const parsed = platformAuditGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    const { scope, ...query } = parsed.data
    return NextResponse.json(scope === 'template' ? await listTemplateAudit(query) : await listPlatformAudit(query))
  } catch (err) {
    log.error({ err }, 'failed to list the audit log')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
}
