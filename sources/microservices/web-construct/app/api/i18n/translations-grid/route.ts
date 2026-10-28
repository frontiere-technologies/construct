import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { deniedActor } from '@/lib/rbac/route-denial'
import { answerTranslationsGrid } from '@/lib/i18n/grid-handlers'

export async function POST(req: NextRequest) {
  const actor = await requirePermission('read-translations').catch(deniedActor)
  if (!actor) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }
  return answerTranslationsGrid(req)
}
