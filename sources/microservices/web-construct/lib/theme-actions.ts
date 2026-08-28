'use server'

import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { themeContrastViolations, type ContrastViolation } from '@/lib/theme-vars'
import type { ThemeConfig } from '@/types/menu'

/**
 * Il tema salvato vince sul predefinito, quindi il pavimento di contrasto che
 * `lib/theme-vars.test.ts` fissa sui valori spediti qui non protegge nulla: e'
 * questo il punto in cui un colore illeggibile entra nel database e finisce a
 * vestire testo piccolo. Si rifiuta prima di scrivere, e si dice quali colori
 * sono in difetto — un rifiuto che non nomina il colpevole non e' azionabile.
 *
 * `primaryColor` resta fuori: e' un colore di marchio, e l'etichetta la deriva
 * `primaryForeground()`. Vedi il commento su `themeContrastViolations`.
 *
 * Il rifiuto guarda la configurazione intera, non solo i campi appena
 * modificati: chi ha salvato un tema prima che la tavolozza accessibile
 * esistesse porta ancora i vecchi valori, e li rifiuta il primo salvataggio che
 * fa. E' voluto — quei colori sono illeggibili adesso, non in astratto — e il
 * pannello ne esce con «Valori di Default», che ricarica una tavolozza
 * conforme. La migrazione 0007 solleva gia' quei valori, ma non puo' impedire
 * che domani qualcuno ne scelga di nuovi: e' per questo che il controllo sta
 * qui e non solo la'.
 */
export async function saveThemeConfig(
  config: ThemeConfig,
): Promise<{ error: string | null; violations?: ContrastViolation[] }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  const violations = themeContrastViolations(config)
  if (violations.length > 0) {
    const detail = violations.map(v => `${v.key} ${v.ratio.toFixed(2)}:1`).join(', ')
    return { error: `Contrast below ${violations[0].floor}:1 — ${detail}`, violations }
  }

  try {
    await db.update(users).set({ themeConfig: config }).where(eq(users.id, session.user.id))
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadThemeConfig(): Promise<ThemeConfig | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const [row] = await db
    .select({ themeConfig: users.themeConfig })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  return (row?.themeConfig as ThemeConfig) ?? null
}
