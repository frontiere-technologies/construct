import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { listLanguagesPage, listActiveLanguages } from './language-service'
import { languagesGridQuerySchema } from './languages-grid-query-schema'
import { listTranslations } from './translation-service'
import { translationsGridQuerySchema } from './translations-grid-query-schema'

const log = createLogger('i18n-grid')

/**
 * Le risposte delle due griglie dei cataloghi (lingue e traduzioni), condivise dalla rotta del
 * tenant (sola lettura, permesso `read-*`) e da quella della console (amministratore di piattaforma,
 * MT5-DEC-24). Il controllo di chi chiede resta nella rotta, prima di chiamare queste: non hanno
 * guardia propria e non vanno chiamate da altro.
 */
export async function answerLanguagesGrid(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => null)
  const parsed = languagesGridQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Corpo della richiesta non valido.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await listLanguagesPage(parsed.data))
  } catch (err) {
    // Un guasto non esce mai col suo testo: si registra qui, e chi chiede riceve un messaggio generico.
    log.error({ err }, 'failed to list the languages')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
}

export async function answerTranslationsGrid(req: Request): Promise<NextResponse> {
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
    log.error({ err }, 'failed to list the translations')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }
}
