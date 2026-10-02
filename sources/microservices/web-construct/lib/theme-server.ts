import { cache } from 'react'
import { db } from '@/lib/db'
import { appTheme } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { DEFAULT_PRIMARY } from './theme-vars'

const log = createLogger('theme')

/**
 * Il colore principale dell'app (DEC-1). Un database irraggiungibile non deve
 * impedire di disegnare la pagina: si ripiega sul predefinito.
 */
export const getAppPrimaryColor = cache(async (): Promise<string> => {
  try {
    const [row] = await db.select({ primaryColor: appTheme.primaryColor }).from(appTheme).limit(1)
    return row?.primaryColor ?? DEFAULT_PRIMARY
  } catch (err) {
    log.error({ err }, 'failed to read the application colour')
    return DEFAULT_PRIMARY
  }
})
