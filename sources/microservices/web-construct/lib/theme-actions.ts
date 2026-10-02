'use server'

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { appTheme } from '@/lib/db/schema'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createLogger } from '@/lib/logger'
import { derivePrimary } from '@/lib/theme-vars'

const log = createLogger('theme')

const primaryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase())

export type SavePrimaryError = 'unauthorized' | 'invalid' | 'unreadable' | 'failed'

/**
 * Il colore principale dell'app, uno per tutti (DEC-1). `requireAdmin` e non
 * `session.user.isAdmin`: verifica i ruoli sul database, quindi un admin
 * declassato con un JWT ancora valido viene rifiutato.
 */
export async function saveAppPrimaryColor(color: string): Promise<{ error: SavePrimaryError | null }> {
  try {
    await requireAdmin()
  } catch (err) {
    // Un rifiuto vero e' normale; qualunque altro errore (database fuori uso) va
    // lasciato in traccia, anche se all'utente si risponde nello stesso modo.
    if (!(err instanceof Error && err.message === 'Unauthorized')) log.error({ err }, 'admin check failed')
    return { error: 'unauthorized' }
  }

  const parsed = primaryColorSchema.safeParse(color)
  if (!parsed.success) return { error: 'invalid' }
  if (!derivePrimary(parsed.data)) return { error: 'unreadable' }

  try {
    const rows = await db.update(appTheme).set({ primaryColor: parsed.data, dateMod: sql`now()` }).returning({ id: appTheme.id })
    if (rows.length === 0) {
      log.error('app_theme has no row to update')
      return { error: 'failed' }
    }
    return { error: null }
  } catch (err) {
    log.error({ err }, 'failed to save the application colour')
    return { error: 'failed' }
  }
}
