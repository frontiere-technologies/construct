import { createLogger } from '@/lib/logger'

const log = createLogger('rbac')

/**
 * Per le rotte API: `await requirePermission(code).catch(deniedActor)`, poi 403 se l'attore è `null`.
 *
 * Un rifiuto (`Unauthorized`, il messaggio di `auth-guard.ts`) è la risposta prevista e non si
 * registra. Ogni altro guasto — database irraggiungibile, sessione illeggibile — risponde 403 lo
 * stesso, perché senza un attore verificato non si apre niente; ma prima si registra, altrimenti
 * un'interruzione si confonderebbe con una raffica di permessi negati. Stesso schema di
 * `saveAppTheme` in `lib/theme-actions.ts`.
 */
export function deniedActor(err: unknown): null {
  if (!(err instanceof Error && err.message === 'Unauthorized')) log.error({ err }, 'permission check failed')
  return null
}
