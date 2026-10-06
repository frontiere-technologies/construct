import { cache } from 'react'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { APPEARANCE_COOKIE, anonymousAppearance, parseAppearanceCookie, toAppearance, type Appearance } from './appearance'

const log = createLogger('appearance')

/**
 * Le preferenze di aspetto della richiesta (specifica §2.3): il profilo per un
 * utente autenticato; per un visitatore anonimo il modo e' sempre chiaro e dal
 * cookie si legge solo la scala (`anonymousAppearance`).
 * Il profilo viene prima del cookie perche' un cookie di un anno su un secondo
 * browser resterebbe fermo a una scelta che l'utente ha gia' cambiato altrove.
 */
export const getAppearance = cache(async (): Promise<Appearance> => {
  const session = await auth()
  const userId = session?.user?.id
  if (userId) {
    try {
      const [row] = await db
        .select({ themeMode: users.themeMode, textScale: users.textScale })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      if (row) return toAppearance(row)
    } catch (err) {
      log.error({ err }, 'failed to read the appearance preference')
    }
  }
  const store = await cookies()
  return anonymousAppearance(parseAppearanceCookie(store.get(APPEARANCE_COOKIE)?.value))
})
