import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { translationKey, translationValue } from '@/lib/db/schema'
import { MAX_VALUE_LENGTH, type SaveTranslationsInput } from './types'
import { cleanupTestData, describeIntegration, testKey, unique } from './test-support/db-fixtures'

// Same rationale as language-actions.integration.test.ts: requireAdmin() and
// revalidatePath() are session-/request-bound and don't exist in a Vitest
// process. The authorization path itself is covered by the E2E suite.
vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'test', isAdmin: true } }) }))

const { createTranslationKey, deleteTranslationKey, saveTranslations } = await import('./translation-actions')
// listTranslations lives in translation-service.ts, not translation-actions.ts —
// it needs no requireAdmin() guard since it is a read used by the (already
// admin-gated) grid route, not a mutation.
const { listTranslations } = await import('./translation-service')

describeIntegration('translation actions against the database', () => {
  // `zzz_i18n_test` on its own satisfies `isValidNamespace` (`^[a-z][a-z0-9_]*$`).
  const namespace = 'zzz_i18n_test'
  let key: string

  beforeEach(() => { key = testKey(`k${unique()}.label`) })
  afterEach(cleanupTestData)

  const keyInput = (over: Partial<{ key: string; description: string | null; namespace: string; module: string | null }> = {}) => ({
    key, description: null, namespace, module: null, ...over,
  })

  /** Creates a key and asserts the setup itself didn't fail, returning its id. */
  async function createKey(over: Partial<{ key: string; description: string | null; namespace: string; module: string | null }> = {}): Promise<number> {
    const created = await createTranslationKey(keyInput(over))
    if (created.error || created.id === undefined) throw new Error(`setup: createTranslationKey failed: ${created.error}`)
    return created.id
  }

  const saveInput = (keyId: number, over: Partial<SaveTranslationsInput> = {}): SaveTranslationsInput => ({
    keyId, keyVersion: 1, description: null, namespace, module: null, values: [], ...over,
  })

  it('creates a key and reads it back through listTranslations', async () => {
    const created = await createTranslationKey(keyInput())
    expect(created).toEqual({ error: null, id: expect.any(Number) })

    const page = await listTranslations({ page: 0, size: 50, search: key })
    expect(page.total).toBe(1)
    expect(page.elements).toHaveLength(1)
    expect(page.elements[0].key).toBe(key)
    expect(page.elements[0].missingCodes.sort()).toEqual(['en', 'it'])
  })

  it('rejects a duplicate key', async () => {
    await createTranslationKey(keyInput())
    const second = await createTranslationKey(keyInput())
    expect(second.error).toMatch(/esiste già/i)
  })

  it('rejects a malformed key', async () => {
    expect((await createTranslationKey(keyInput({ key: 'Common.Save' }))).error).toMatch(/chiave non valida/i)
    expect((await createTranslationKey(keyInput({ key: 'common save' }))).error).toMatch(/chiave non valida/i)
  })

  it('writes values for both languages, each starting at version 1', async () => {
    const keyId = await createKey()
    const result = await saveTranslations(saveInput(keyId, {
      values: [
        { languageCode: 'it', value: 'Ciao', version: null },
        { languageCode: 'en', value: 'Hello', version: null },
      ],
    }))
    expect(result).toEqual({ ok: true })

    const rows = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.version).toBe(1)

    const page = await listTranslations({ page: 0, size: 50, search: key })
    expect(page.elements[0].values.it.value).toBe('Ciao')
    expect(page.elements[0].values.en.value).toBe('Hello')
  })

  it('rejects a stale keyVersion once the metadata has changed, without touching the stored value', async () => {
    const keyId = await createKey()
    // Bumps translation_key.version from 1 to 2 (metadata — description — actually changed).
    const first = await saveTranslations(saveInput(keyId, {
      description: 'updated description',
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))
    expect(first).toEqual({ ok: true })

    const [keyRow] = await db.select().from(translationKey).where(eq(translationKey.idTranslationKey, keyId))
    expect(keyRow.version).toBe(2)

    // Retried with the original (now-stale) keyVersion: 1.
    const stale = await saveTranslations(saveInput(keyId, {
      keyVersion: 1,
      description: 'updated description',
      values: [{ languageCode: 'it', value: 'Ciao di nuovo', version: 1 }],
    }))
    expect(stale.ok).toBe(false)
    expect(!stale.ok && 'error' in stale ? stale.error : null).toMatch(/modificata/i)

    const [valueRow] = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    expect(valueRow.value).toBe('Ciao')
  })

  it('rejects a stale per-value version, reporting the conflict and leaving the stored value unchanged', async () => {
    const keyId = await createKey()
    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))
    // A concurrent editor reads version 1 and saves first, advancing it to 2 —
    // simulated here as a second, legitimate saveTranslations call using the
    // version the first save actually produced.
    const concurrent = await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao concorrente', version: 1 }],
    }))
    expect(concurrent).toEqual({ ok: true })

    // We still hold the original (now-stale) version: 1.
    const stale = await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao ormai vecchio', version: 1 }],
    }))
    expect(stale.ok).toBe(false)
    expect(!stale.ok && 'conflicts' in stale ? stale.conflicts : null).toEqual([
      { languageCode: 'it', currentValue: 'Ciao concorrente', attemptedValue: 'Ciao ormai vecchio' },
    ])

    const [valueRow] = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    expect(valueRow.value).toBe('Ciao concorrente')
  })

  it('deletes the value row on an empty value and reports the language as missing', async () => {
    const keyId = await createKey()
    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))
    const deleted = await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: '', version: 1 }],
    }))
    expect(deleted).toEqual({ ok: true })

    const rows = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    expect(rows).toHaveLength(0)

    const page = await listTranslations({ page: 0, size: 50, search: key })
    expect(page.elements[0].missingCodes).toContain('it')
  })

  it('filters by status: missing before both languages are filled, complete once they are', async () => {
    const keyId = await createKey()
    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))

    const missing = await listTranslations({ page: 0, size: 50, search: key, status: 'missing' })
    expect(missing.elements.map(e => e.key)).toContain(key)
    const completeBefore = await listTranslations({ page: 0, size: 50, search: key, status: 'complete' })
    expect(completeBefore.elements.map(e => e.key)).not.toContain(key)

    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'en', value: 'Hello', version: null }],
    }))

    const missingAfter = await listTranslations({ page: 0, size: 50, search: key, status: 'missing' })
    expect(missingAfter.elements.map(e => e.key)).not.toContain(key)
    const completeAfter = await listTranslations({ page: 0, size: 50, search: key, status: 'complete' })
    expect(completeAfter.elements.map(e => e.key)).toContain(key)
  })

  it('narrows results by namespace and module', async () => {
    await createKey()
    const otherModule = 'zzzmod'
    const otherKey = testKey(`k${unique()}.other`)
    await createKey({ key: otherKey, module: otherModule })

    const byNamespace = await listTranslations({ page: 0, size: 50, namespace })
    expect(byNamespace.elements.map(e => e.key)).toEqual(expect.arrayContaining([key, otherKey]))

    const byModule = await listTranslations({ page: 0, size: 50, namespace, module: otherModule })
    expect(byModule.elements).toHaveLength(1)
    expect(byModule.elements[0].key).toBe(otherKey)
  })

  it('deleteTranslationKey removes the key and its values', async () => {
    const keyId = await createKey()
    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))

    expect(await deleteTranslationKey(keyId)).toEqual({ error: null })
    expect(await db.select().from(translationKey).where(eq(translationKey.idTranslationKey, keyId))).toHaveLength(0)
    expect(await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))).toHaveLength(0)
  })

  it('rejects a value over the length limit before writing anything', async () => {
    const keyId = await createKey()
    const tooLong = 'a'.repeat(MAX_VALUE_LENGTH + 1)
    const result = await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: tooLong, version: null }],
    }))
    expect(result.ok).toBe(false)
    expect(!result.ok && 'error' in result ? result.error : null).toMatch(new RegExp(String(MAX_VALUE_LENGTH)))

    const rows = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    expect(rows).toHaveLength(0)
  })
})
