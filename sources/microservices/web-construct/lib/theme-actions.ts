'use server'

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { appTheme } from '@/lib/db/schema'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createLogger } from '@/lib/logger'
import { themeContrastWarnings, type AppTheme, type ContrastWarning, type SurfaceOverrides } from '@/lib/theme-vars'

const log = createLogger('theme')

const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase())

/** Una superficie assente o null vuol dire «il valore fisso». */
const surfacesSchema = z.object({
  background: hexSchema.nullish(),
  card: hexSchema.nullish(),
  accent: hexSchema.nullish(),
  sidebar: hexSchema.nullish(),
})

const themeSchema = z.object({
  primaryColor: hexSchema,
  /** Assente o null: il colore del modo scuro si ricava dal chiaro (DEC-10). */
  primaryDark: hexSchema.nullish(),
  surfaces: z.object({ light: surfacesSchema, dark: surfacesSchema }),
})

/** Le sole superfici cambiate, come le vuole `themeContrastWarnings`. */
function present(surfaces: z.infer<typeof surfacesSchema>): SurfaceOverrides {
  return Object.fromEntries(Object.entries(surfaces).filter(([, value]) => typeof value === 'string'))
}

export type SaveThemeError = 'unauthorized' | 'invalid' | 'failed'

interface ThemeSaved {
  saved: true
  error: null
}

interface ThemeRefused {
  saved: false
  error: SaveThemeError
}

/** Non salvato, e non per un errore: i colori si leggono male e l'admin deve decidere. */
interface ThemeNeedsAcknowledgement {
  saved: false
  error: null
  warnings: ContrastWarning[]
}

export type SaveThemeResult = ThemeSaved | ThemeRefused | ThemeNeedsAcknowledgement

/**
 * Il tema dell'app, uno per tutti (DEC-1, DEC-9): colore principale e superfici.
 * `requireAdmin` e non `session.user.isAdmin`: verifica i ruoli sul database,
 * quindi un admin declassato con un JWT ancora valido viene rifiutato.
 *
 * Il contrasto si decide qui, una volta sola per tutti: se qualcosa si legge
 * male non si scrive niente e si restituisce l'elenco dei problemi. La pagina lo
 * mostra e, se l'admin conferma, richiama con `acknowledgeWarnings`: allora si
 * salva lo stesso. E' un avviso, non un rifiuto.
 */
export async function saveAppTheme(
  theme: AppTheme,
  options?: { acknowledgeWarnings?: boolean },
): Promise<SaveThemeResult> {
  // Un'azione server riceve quello che il client manda, non quello che dice il tipo:
  // vale come conferma solo un `true` vero, e un null non deve far lanciare.
  const acknowledged = options?.acknowledgeWarnings === true

  try {
    await requireAdmin()
  } catch (err) {
    // Un rifiuto vero e' normale; qualunque altro errore (database fuori uso) va
    // lasciato in traccia, anche se all'utente si risponde nello stesso modo.
    if (!(err instanceof Error && err.message === 'Unauthorized')) log.error({ err }, 'admin check failed')
    return { saved: false, error: 'unauthorized' }
  }

  const parsed = themeSchema.safeParse(theme)
  if (!parsed.success) return { saved: false, error: 'invalid' }
  const { primaryColor, surfaces } = parsed.data
  const primaryDark = parsed.data.primaryDark ?? null
  const light = present(surfaces.light)
  const dark = present(surfaces.dark)

  const warnings = themeContrastWarnings({ primaryColor, primaryDark, surfaces: { light, dark } })
  if (warnings.length > 0 && !acknowledged) return { saved: false, error: null, warnings }

  try {
    const rows = await db.update(appTheme).set({
      primaryColor,
      primaryDark,
      backgroundLight: light.background ?? null,
      cardLight: light.card ?? null,
      accentLight: light.accent ?? null,
      sidebarLight: light.sidebar ?? null,
      backgroundDark: dark.background ?? null,
      cardDark: dark.card ?? null,
      accentDark: dark.accent ?? null,
      sidebarDark: dark.sidebar ?? null,
      dateMod: sql`now()`,
    }).returning({ id: appTheme.id })
    if (rows.length === 0) {
      log.error('app_theme has no row to update')
      return { saved: false, error: 'failed' }
    }
    return { saved: true, error: null }
  } catch (err) {
    log.error({ err }, 'failed to save the application theme')
    return { saved: false, error: 'failed' }
  }
}
