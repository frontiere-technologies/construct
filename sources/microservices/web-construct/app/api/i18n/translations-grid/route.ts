import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listTranslations } from '@/lib/i18n/translation-service'
import { translationsGridQuerySchema } from '@/lib/i18n/translations-grid-query-schema'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const parsed = translationsGridQuerySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listTranslations(parsed.data))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
