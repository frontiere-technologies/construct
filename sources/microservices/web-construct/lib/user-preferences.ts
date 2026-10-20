import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { appLanguage, users } from '@/lib/db/schema'

export interface UserPreferences {
  languageCode: string | null
  themeMode: string
  textScale: number
}

/**
 * Lingua del profilo e aspetto vengono dalla stessa riga di `users`: una lettura per richiesta
 * invece di due transazioni (specifica 2026-10-15, §2.4). Chi la usa gestisce l'errore come prima.
 * `themeMode` e `textScale` sono NOT NULL nello schema: toAppearance li riceve com'è oggi.
 */
export const getUserPreferences = cache(async (userId: string): Promise<UserPreferences | null> => {
  const [row] = await withGlobal(tx => tx
    .select({ languageCode: appLanguage.code, themeMode: users.themeMode, textScale: users.textScale })
    .from(users)
    .leftJoin(appLanguage, eq(appLanguage.idLanguage, users.idLanguage))
    .where(eq(users.id, userId))
    .limit(1))
  return row ?? null
})
