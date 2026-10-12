import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { listLanguagesPage } from '@/lib/i18n/language-service'
import { languagesGridQuerySchema } from '@/lib/i18n/languages-grid-query-schema'

export async function POST(req: NextRequest) {
  const actor = await requirePermission('read-languages').catch(deniedActor)
  if (!actor) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = languagesGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listLanguagesPage(parsed.data))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
