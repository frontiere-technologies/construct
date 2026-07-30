'use server'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appLanguage, users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { listActiveLanguages } from './language-service'
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, LANG_SESSION_COOKIE } from './types'

const log = createLogger('i18n-preference')

/**
 * Persist the user's choice.
 *
 * Authenticated users get it written to their profile so it follows them to a
 * new device or a new session (§5.3); the cookies are written for everyone, and
 * are the only storage an anonymous visitor gets (§5.4). localStorage is
 * deliberately not used — it is invisible to the server, so the first paint
 * would always be in the wrong language.
 */
export async function setPreferredLanguage(code: string): Promise<{ error: string | null }> {
  const languages = await listActiveLanguages()
  const language = languages.find(l => l.code === code)
  if (!language) return { error: 'Lingua non disponibile.' }

  const session = await auth()
  const userId = session?.user?.id
  if (userId) {
    try {
      await db.update(users).set({ idLanguage: language.id }).where(eq(users.id, userId))
    } catch (err) {
      log.error({ err }, 'failed to persist the user language preference')
      return { error: 'Impossibile salvare la preferenza di lingua.' }
    }
  }

  const store = await cookies()
  const common = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  }
  store.set(LANG_SESSION_COOKIE, language.code, common)
  store.set(LANG_COOKIE, language.code, { ...common, maxAge: LANG_COOKIE_MAX_AGE })
  return { error: null }
}

/** The code currently stored on the authenticated user's profile, if any. */
export async function getPreferredLanguage(): Promise<string | null> {
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
