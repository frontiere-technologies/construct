import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listTranslations } from '@/lib/i18n/translation-service'
import type { TranslationsQuery, TranslationStatusFilter } from '@/lib/i18n/types'

const MAX_PAGE_SIZE = 200
const ALLOWED_STATUS = new Set<TranslationStatusFilter>(['all', 'missing', 'complete'])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const query = (await req.json().catch(() => null)) as TranslationsQuery | null
  // `typeof … === 'number'` alone lets NaN, negative page/size or an
  // oversized `size` reach limit()/offset() (500 with a raw PG message), and
  // an arbitrary `status` string fall through to the "no filter" branch
  // silently instead of being rejected.
  if (
    !query ||
    !Number.isInteger(query.page) || query.page < 0 ||
    !Number.isInteger(query.size) || query.size < 0 || query.size > MAX_PAGE_SIZE ||
    (query.status !== undefined && !ALLOWED_STATUS.has(query.status))
  ) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listTranslations({ ...query, size: Math.min(query.size, 200) }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore interno.' }, { status: 500 })
  }
}
