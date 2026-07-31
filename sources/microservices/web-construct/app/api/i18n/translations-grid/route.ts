import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listTranslations } from '@/lib/i18n/translation-service'
import { listActiveLanguages } from '@/lib/i18n/language-service'
import { translationsGridQuerySchema } from '@/lib/i18n/translations-grid-query-schema'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = translationsGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    const activeCodes = new Set((await listActiveLanguages()).map(language => language.code))
    const rawValueSearches = body && typeof body === 'object' && !Array.isArray(body)
      ? Object.getOwnPropertyDescriptor(body, 'valueSearches')?.value
      : undefined
    const hasUnknownValueSearch = rawValueSearches && typeof rawValueSearches === 'object' && !Array.isArray(rawValueSearches)
      && Object.getOwnPropertyNames(rawValueSearches).some(code => !activeCodes.has(code))
    if (
      (parsed.data.languageCode && !activeCodes.has(parsed.data.languageCode)) ||
      hasUnknownValueSearch
    ) {
      return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
    }

    return NextResponse.json(await listTranslations(parsed.data))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
