import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appLanguage, users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { listLanguages } from './language-service'
import { getDictionaryBundle } from './dictionary-service'
import { resolveActiveLanguage } from './resolve-language'
import { createTranslator } from './translator'
import { createFormatters, type Formatters } from './format'
import { LANG_COOKIE, LANG_SESSION_COOKIE, type Dictionary, type LanguageDto, type TranslateFn } from './types'

const log = createLogger('i18n')

/** Everything a client component needs to translate and format, serialisable as props. */
export interface I18nBundle {
  language: LanguageDto
  languages: LanguageDto[]
  dict: Dictionary
  defaultDict: Dictionary
  isDev: boolean
}

export interface ServerI18n extends I18nBundle {
  t: TranslateFn
  fmt: Formatters
}

/**
 * Missing keys are logged once per process, not once per request: a label that
 * is missing on a hot page would otherwise emit a log line on every render
 * (§7.3). Bounded so a malicious or buggy caller cannot grow it without limit.
 */
const MAX_REPORTED_KEYS = 500
const reportedKeys = new Set<string>()

function reportMissing(key: string, code: string): void {
  if (reportedKeys.has(key)) return
  if (reportedKeys.size >= MAX_REPORTED_KEYS) return
  reportedKeys.add(key)
  // Key + language only — never the interpolation parameters, which can carry
  // personal data (§7.3, §13.2).
  log.warn({ key, language: code }, 'missing translation')
}

async function profileLanguageCode(): Promise<string | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  try {
    const [row] = await db
      .select({ code: appLanguage.code })
      .from(users)
      .leftJoin(appLanguage, eq(appLanguage.idLanguage, users.idLanguage))
      .where(eq(users.id, userId))
      .limit(1)
    return row?.code ?? null
  } catch (err) {
    log.error({ err }, 'failed to read the user language preference')
    return null
  }
}

/**
 * Resolve the active language and build the request's translator.
 *
 * React `cache()` makes this once-per-request even though the root layout, the
 * protected layout and individual pages all call it.
 *
 * Reading cookies here opts every route into dynamic rendering. That is not a
 * regression: `auth()` in the protected layout and middleware already forces it
 * for the whole authenticated surface, and this app is deployed as a Node
 * server, not as a static export.
 */
export const getI18n = cache(async (): Promise<ServerI18n> => {
  const [cookieStore, headerList, languages] = await Promise.all([
    cookies(), headers(), listLanguages(),
  ])

  const sessionChoice = cookieStore.get(LANG_SESSION_COOKIE)?.value ?? null
  const persistentCookie = cookieStore.get(LANG_COOKIE)?.value ?? null
  // An explicit in-session choice already wins (§6.1), so skip the profile query.
  const profileCode = sessionChoice ? null : await profileLanguageCode()

  const { language } = resolveActiveLanguage({
    sessionChoice,
    profileCode,
    persistentCookie,
    acceptLanguage: headerList.get('accept-language'),
    languages,
  })

  const { dict, defaultDict } = await getDictionaryBundle(language.code)
  const isDev = process.env.NODE_ENV !== 'production'

  return {
    language,
    languages: languages.filter(l => l.isActive),
    dict,
    defaultDict,
    isDev,
    t: createTranslator({
      dict, defaultDict, locale: language.locale, isDev,
      onMissing: key => reportMissing(key, language.code),
    }),
    fmt: createFormatters(language.locale),
  }
})

export async function getActiveLanguage(): Promise<LanguageDto> {
  return (await getI18n()).language
}

/** The props-safe slice of the bundle — the functions cannot cross the RSC boundary. */
export async function getI18nBundle(): Promise<I18nBundle> {
  const { language, languages, dict, defaultDict, isDev } = await getI18n()
  return { language, languages, dict, defaultDict, isDev }
}
