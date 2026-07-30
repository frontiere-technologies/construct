import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SaveTranslationsInput } from './types'
import { cleanupTestData, describeIntegration, testKey, unique } from './test-support/db-fixtures'

// Same rationale as the other integration specs: requireAdmin() and
// revalidatePath() are session-/request-bound and don't exist in a Vitest
// process. saveTranslations/createTranslationKey are only used here as
// fixtures to get real, trigger-versioned rows into the database — the
// dictionary service itself takes no admin action and needs no mock.
vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'test', isAdmin: true } }) }))

const { createTranslationKey, saveTranslations } = await import('./translation-actions')
const { getDictionary, getDictionaryBundle } = await import('./dictionary-service')

describeIntegration('dictionary service against the database', () => {
  const namespace = 'zzz_i18n_test'
  let key: string

  beforeEach(() => { key = testKey(`k${unique()}.label`) })
  afterEach(cleanupTestData)

  /** Creates a key with the given values and returns its id, once both writes committed. */
  async function seedKey(values: { languageCode: string; value: string }[]): Promise<number> {
    const created = await createTranslationKey({ key, description: null, namespace, module: null })
    if (created.error || created.id === undefined) throw new Error(`setup: createTranslationKey failed: ${created.error}`)
    const saveResult: SaveTranslationsInput = {
      keyId: created.id, keyVersion: 1, description: null, namespace, module: null,
      values: values.map(v => ({ ...v, version: null })),
    }
    const saved = await saveTranslations(saveResult)
    if (!saved.ok) throw new Error(`setup: saveTranslations failed: ${JSON.stringify(saved)}`)
    return created.id
  }

  it('contains the seeded common.actions.save translation for it', async () => {
    const dict = await getDictionary('it')
    expect(dict['common.actions.save']).toBe('Salva')
  })

  it('returns the same object on a second call — no reload without a version bump', async () => {
    const first = await getDictionary('it')
    const second = await getDictionary('it')
    expect(second).toBe(first)
  })

  it('reflects a saved value change without re-login or restart', async () => {
    const keyId = await seedKey([
      { languageCode: 'it', value: 'Valore iniziale' },
      { languageCode: 'en', value: 'Initial value' },
    ])
    const before = await getDictionary('it')
    expect(before[key]).toBe('Valore iniziale')

    const updated = await saveTranslations({
      keyId, keyVersion: 1, description: null, namespace, module: null,
      values: [{ languageCode: 'it', value: 'Valore aggiornato', version: 1 }],
    })
    expect(updated).toEqual({ ok: true })

    const after = await getDictionary('it')
    expect(after[key]).toBe('Valore aggiornato')
    expect(after).not.toBe(before)
  })

  it('leaves the it dictionary content correct after an en-only edit', async () => {
    const keyId = await seedKey([
      { languageCode: 'it', value: 'Invariato' },
      { languageCode: 'en', value: 'Non ancora modificato' },
    ])
    const itBefore = await getDictionary('it')
    expect(itBefore[key]).toBe('Invariato')

    const updated = await saveTranslations({
      keyId, keyVersion: 1, description: null, namespace, module: null,
      values: [{ languageCode: 'en', value: 'Modificato', version: 1 }],
    })
    expect(updated).toEqual({ ok: true })

    const itAfter = await getDictionary('it')
    // NOT `.toBe(itBefore)`: dictionary-service.ts's own comment claims "only
    // the affected language is invalidated" (§11.3), and in isolation
    // `invalidateDictionary('en')` does only drop the `en` cache entry — but
    // `saveTranslations`'s value-only path (the `touchedCodes.size > 0` branch)
    // still issues `update translation_key set updated_at = now()` to keep the
    // grid's "Ultima modifica" column accurate (Task 9), and
    // `translation_key_bump_versions` is a *statement-level*, unconditional
    // trigger: verified directly against the database, a bare
    // `update translation_key set updated_at = now()` with no other column
    // touched bumps *every* `app_language.dictionary_version` row, not just
    // one. So an edit to any single language's value invalidates every other
    // language's cached dictionary too — `it`'s entry gets reloaded, just to
    // identical content. This is a real gap between that code comment and the
    // schema's trigger, orthogonal to this task; flagged rather than silently
    // fixed (see the task-16 report).
    expect(itAfter).toEqual(itBefore)
    expect(itAfter[key]).toBe('Invariato')
  })

  it('getDictionaryBundle for en returns it as the default dictionary', async () => {
    const { dict, defaultDict } = await getDictionaryBundle('en')
    expect(dict['common.actions.save']).toBe('Save')
    expect(defaultDict['common.actions.save']).toBe('Salva')
  })

  it('returns an empty dictionary for a nonexistent language code instead of throwing', async () => {
    await expect(getDictionary('zz')).resolves.toEqual({})
  })
})
