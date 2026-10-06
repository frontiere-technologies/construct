'use server'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { shouldUseSecureCookies } from '@/lib/i18n/cookie-security'
import {
  APPEARANCE_COOKIE, APPEARANCE_COOKIE_MAX_AGE, appearancePatchSchema, serializeAppearance, toAppearance,
  type Appearance, type AppearancePatch,
} from './appearance'

const log = createLogger('appearance')

/**
 * Salva una preferenza di aspetto sul profilo e la ricopia nel cookie, che
 * serve solo alle pagine anonime (specifica §2.3). Restituisce i valori come
 * stanno sul database, non come sono arrivati.
 */
export async function saveAppearance(
  patch: AppearancePatch,
): Promise<{ error: string | null; appearance?: Appearance }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: 'Not authenticated' }

  const parsed = appearancePatchSchema.safeParse(patch)
  if (!parsed.success || (parsed.data.mode === undefined && parsed.data.scale === undefined)) {
    return { error: 'Invalid appearance' }
  }

  const values: { themeMode?: Appearance['mode']; textScale?: Appearance['scale'] } = {}
  if (parsed.data.mode !== undefined) values.themeMode = parsed.data.mode
  if (parsed.data.scale !== undefined) values.textScale = parsed.data.scale

  try {
    const [row] = await db
      .update(users)
      .set(values)
      .where(eq(users.id, userId))
      .returning({ themeMode: users.themeMode, textScale: users.textScale })
    if (!row) return { error: 'Not authenticated' }

    const appearance = toAppearance(row)
    const store = await cookies()
    store.set(APPEARANCE_COOKIE, serializeAppearance(appearance), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureCookies(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL, process.env.NODE_ENV),
      maxAge: APPEARANCE_COOKIE_MAX_AGE,
    })
    return { error: null, appearance }
  } catch (err) {
    log.error({ err }, 'failed to save the appearance preference')
    return { error: 'Save failed' }
  }
}
