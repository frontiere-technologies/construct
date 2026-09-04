import { describe } from 'vitest'
import { like, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey } from '@/lib/db/schema'

/** Every row these tests create carries this prefix so cleanup is unambiguous. */
export const TEST_PREFIX = 'zzz_i18n_test_'

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
  await db.delete(translationKey).where(like(translationKey.key, `${TEST_PREFIX}%`))
  await db.delete(appLanguage).where(or(
    like(appLanguage.name, `${TEST_PREFIX}%`),
    like(appLanguage.nativeName, `${TEST_PREFIX}%`),
  )!)
}
