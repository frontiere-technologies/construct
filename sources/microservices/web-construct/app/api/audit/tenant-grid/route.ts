import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { auditGridQuerySchema } from '@/lib/audit/audit-grid-query-schema'
import { listTenantAudit } from '@/lib/audit/audit-read-service'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'

const log = createLogger('tenant-audit-grid')

/**
 * La griglia del registro del tenant (specifica 2026-10-26, MT5-DEC-16, MT5-OK-4). Il tenant è
 * quello dell'attore, mai uno che arriva nel corpo; il controllo viene prima di leggere il corpo.
 */
export async function POST(req: NextRequest) {
  const actor = await requirePermission('read-tenant-audit').catch(deniedActor)
  if (!actor) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = auditGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listTenantAudit(actor.tenantId, parsed.data))
  } catch (err) {
    log.error({ err }, 'failed to list the tenant audit log')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
}
