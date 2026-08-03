import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('i18n-audit')

/**
 * Structured best-effort diagnostic event for every admin i18n mutation.
 *
 * This repo has no audit *table* — adding one would be a new subsystem for a
 * feature that does not need it, so the event goes to the existing Pino stream
 * with a stable `audit: 'i18n'` marker that a log pipeline can select on.
 * Completeness, append-only storage, access control, alerting, and retention are
 * explicitly the deployment operator's responsibility; this function provides
 * no compliance-grade durability guarantee.
 *
 * `details` carries identifiers and before/after label values only. Never pass
 * a session, a token or an interpolation parameter: `lib/logger.ts` redacts a
 * fixed key list, it cannot redact what it has not been told about (§13.2).
 */
export async function auditI18n(event: string, details: Record<string, unknown>): Promise<void> {
  // A diagnostic-log hiccup (e.g. `auth()` or the logger itself throwing) must
  // never turn a write that already committed into a reported failure — the
  // caller's mutation has already succeeded by the time this runs, so any
  // error here is swallowed and best-effort logged instead of propagated.
  try {
    const session = await auth()
    log.info({ audit: 'i18n', event, actorId: session?.user?.id ?? null, ...details }, `i18n.${event}`)
  } catch (err) {
    log.error({ err, event }, 'failed to record i18n audit entry')
  }
}
