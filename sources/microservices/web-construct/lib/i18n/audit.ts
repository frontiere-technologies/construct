import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('i18n-audit')

/**
 * Structured audit trail for every admin i18n mutation (§13.1).
 *
 * This repo has no audit *table* — adding one would be a new subsystem for a
 * feature that does not need it, so the trail goes to the existing Pino stream
 * with a stable `audit: 'i18n'` marker that a log pipeline can select on.
 *
 * `details` carries identifiers and before/after label values only. Never pass
 * a session, a token or an interpolation parameter: `lib/logger.ts` redacts a
 * fixed key list, it cannot redact what it has not been told about (§13.2).
 */
export async function auditI18n(event: string, details: Record<string, unknown>): Promise<void> {
  const session = await auth()
  log.info({ audit: 'i18n', event, actorId: session?.user?.id ?? null, ...details }, `i18n.${event}`)
}
