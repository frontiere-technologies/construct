import { describe } from 'vitest'
import { like, or } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { appLanguage, translationKey } from '@/lib/db/schema'

/** Every row these tests create carries this prefix so cleanup is unambiguous. */
export const TEST_PREFIX = 'zzz_i18n_test_'

/**
 * Un id di persona valido (uuid) per gli attori finti dei test: il registro delle modifiche scrive
 * `actor_user_id` come uuid, quindi un id come 'test' non è più accettato. Le fabbriche di `vi.mock` (sollevate sopra gli import)
 * ripetono il valore come testo.
 */
export const TEST_ACTOR_ID = '00000000-0000-4000-8000-0000000000a1'

export const describeIntegration =
  process.env.I18N_INTEGRATION_DB === '1' ? describe : describe.skip

let counter = 0
/** A collision-free suffix, so a re-run after a crash cannot hit a stale row. */
export function unique(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter}`
}

export function testKey(suffix: string): string {
  return `${TEST_PREFIX}${suffix}`
}

/**
 * Delete everything this suite could have created. `translation_value` and
 * `role_permission` rows disappear with their parents (ON DELETE CASCADE), so only
 * the two parent tables need sweeping.
 */
export async function cleanupTestData(): Promise<void> {
  await withGlobal(async tx => {
    await tx.delete(translationKey).where(like(translationKey.key, `${TEST_PREFIX}%`))
    await tx.delete(appLanguage).where(or(
      like(appLanguage.name, `${TEST_PREFIX}%`),
      like(appLanguage.nativeName, `${TEST_PREFIX}%`),
    )!)
  })
}
