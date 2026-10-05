import { cache } from 'react'
import { db } from '@/lib/db'
import { appTheme } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { DEFAULT_APP_THEME, type AppTheme, type SurfaceOverrides } from './theme-vars'

const log = createLogger('theme')

/** Toglie le superfici a null: una chiave assente vuol dire «il valore fisso». */
function overrides(values: Record<keyof SurfaceOverrides, string | null>): SurfaceOverrides {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null))
}

/**
 * Il tema dell'app (DEC-1, DEC-9, DEC-10): il colore principale, quello del modo
 * scuro se scelto, e le superfici cambiate
 * dall'admin. Un database irraggiungibile non deve impedire di disegnare la
 * pagina: si ripiega sui predefiniti. Vale anche per un database a cui manca
 * ancora la 0033: la query nomina le colonne nuove e fallisce tutta, quindi
 * anche il colore principale torna al predefinito finche' la migrazione non c'e'.
 */
export const getAppTheme = cache(async (): Promise<AppTheme> => {
  try {
    const [row] = await db.select({
      primaryColor: appTheme.primaryColor,
      primaryDark: appTheme.primaryDark,
      backgroundLight: appTheme.backgroundLight,
      cardLight: appTheme.cardLight,
      accentLight: appTheme.accentLight,
      sidebarLight: appTheme.sidebarLight,
      backgroundDark: appTheme.backgroundDark,
      cardDark: appTheme.cardDark,
      accentDark: appTheme.accentDark,
      sidebarDark: appTheme.sidebarDark,
    }).from(appTheme).limit(1)
    if (!row) return DEFAULT_APP_THEME
    return {
      primaryColor: row.primaryColor,
      primaryDark: row.primaryDark ?? null,
      surfaces: {
        light: overrides({ background: row.backgroundLight, card: row.cardLight, accent: row.accentLight, sidebar: row.sidebarLight }),
        dark: overrides({ background: row.backgroundDark, card: row.cardDark, accent: row.accentDark, sidebar: row.sidebarDark }),
      },
    }
  } catch (err) {
    log.error({ err }, 'failed to read the application theme')
    return DEFAULT_APP_THEME
  }
})
