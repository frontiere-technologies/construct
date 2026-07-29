import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listTranslations } from '@/lib/i18n/translation-service'
import type { TranslationsQuery } from '@/lib/i18n/types'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const query = (await req.json().catch(() => null)) as TranslationsQuery | null
  if (!query || typeof query.page !== 'number' || typeof query.size !== 'number') {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listTranslations({ ...query, size: Math.min(query.size, 200) }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
