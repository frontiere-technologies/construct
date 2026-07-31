import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
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

  it('applies every compound key-filter condition to the key column only', async () => {
    const descriptionOnly = `description_only_${unique()}`
    await createKey({ description: descriptionOnly })

    const page = await listTranslations({
      page: 0,
      size: 50,
      search: { operator: 'AND', conditions: [key, descriptionOnly] },
    })

    expect(page.elements).toHaveLength(0)
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

  it('rejects a stale keyVersion when the snapshot is already stale (non-racing case, caught by the early JS check)', async () => {
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

  /**
   * The `saveTranslations` call below never reaches the predicate-guarded
   * `UPDATE ... WHERE version = ...` in a racing state: its own SELECT
   * (statement 1 of the two-layer conflict check) already observes the
   * updated row and throws via the early JS comparison — mechanism 1, not
   * mechanism 2. See the companion "real DB-level race" test further below
   * for a genuine interleaved-transaction exercise of mechanism 2.
   */
  it('rejects a stale keyVersion via the real DB-level race (concurrent transaction wins the lock first)', async () => {
    const keyId = await createKey()
    const [initialKeyRow] = await db.select().from(translationKey).where(eq(translationKey.idTranslationKey, keyId))
    expect(initialKeyRow.version).toBe(1)

    // Signals that flip a manually-driven "locker" transaction between its
    // two phases: acquire the row lock, then (once released) perform its own
    // legitimate, version-bumping write and commit.
    let lockerHasLock!: () => void
    const lockerAcquiredLock = new Promise<void>(resolve => { lockerHasLock = resolve })
    let releaseLocker!: () => void
    const lockerMayContinue = new Promise<void>(resolve => { releaseLocker = resolve })

    const lockerDone = db.transaction(async lockerTx => {
      // A plain SELECT takes no lock under READ COMMITTED — FOR UPDATE is
      // what makes the racing saveTranslations() call below actually block
      // on ITS update instead of racing ahead of us.
      await lockerTx.execute(sql`select id_translation_key from translation_key where id_translation_key = ${keyId} for update`)
      lockerHasLock()
      await lockerMayContinue
      // The "other admin" who commits a metadata edit while our racer sits
      // blocked on its own predicate-guarded UPDATE.
      await lockerTx.update(translationKey)
        .set({ version: 2 })
        .where(and(eq(translationKey.idTranslationKey, keyId), eq(translationKey.version, 1)))
    })

    await lockerAcquiredLock

    // A metadata change (different description) so this takes the
    // `metadataChanged` branch and attempts `UPDATE translation_key ... WHERE
    // version = 1` — which blocks behind the locker's FOR UPDATE above. Its
    // own early JS check (`keyRow.version !== input.keyVersion`) still passes
    // here, since the locker hasn't committed its bump yet.
    const racerPromise = saveTranslations(saveInput(keyId, {
      keyVersion: 1,
      description: 'aggiornata durante la race',
      values: [],
    }))

    // No clean signal exists for "the racer's UPDATE is now blocked waiting
    // on the lock" — a short, generous fixed delay is the standard technique
    // here; Postgres's lock wait queue guarantees correctness regardless of
    // the exact delay length, as long as it's long enough for the racer to
    // have reached its blocked UPDATE.
    await new Promise(resolve => setTimeout(resolve, 300))
    releaseLocker()

    const [stale] = await Promise.all([racerPromise, lockerDone])

    expect(stale.ok).toBe(false)
    expect(!stale.ok && 'error' in stale ? stale.error : null).toMatch(/modificata/i)

    const [finalKeyRow] = await db.select().from(translationKey).where(eq(translationKey.idTranslationKey, keyId))
    // The locker's write won; the racer's blocked UPDATE found 0 matching
    // rows once it unblocked and was correctly rejected, not silently lost.
    expect(finalKeyRow.version).toBe(2)
    expect(finalKeyRow.description).toBeNull()
  })

  it('rejects a stale per-value version when the snapshot is already stale (non-racing case, caught by the early JS check)', async () => {
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

  /**
   * Companion to the keyVersion race test above: a genuine interleaved
   * two-transaction race, this time on `translation_value`, so it would fail
   * if the predicate-guarded `UPDATE ... WHERE version = ...` (lines ~257-277
   * of translation-actions.ts) were removed and only the early JS comparison
   * remained.
   */
  it('rejects a stale per-value version via the real DB-level race (concurrent transaction wins the lock first)', async () => {
    const keyId = await createKey()
    await saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao', version: null }],
    }))
    const [initialValueRow] = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    const valueId = initialValueRow.idTranslationValue
    expect(initialValueRow.version).toBe(1)

    let lockerHasLock!: () => void
    const lockerAcquiredLock = new Promise<void>(resolve => { lockerHasLock = resolve })
    let releaseLocker!: () => void
    const lockerMayContinue = new Promise<void>(resolve => { releaseLocker = resolve })

    const lockerDone = db.transaction(async lockerTx => {
      // Takes the row lock a plain SELECT never would under READ COMMITTED —
      // this is what makes saveTranslations()'s own UPDATE below block
      // instead of racing to completion first.
      await lockerTx.execute(sql`select id_translation_value from translation_value where id_translation_value = ${valueId} for update`)
      lockerHasLock()
      await lockerMayContinue
      // The "other admin" who commits first while our racer sits blocked on
      // its own predicate-guarded UPDATE.
      await lockerTx.update(translationValue)
        .set({ value: 'Ciao concorrente', version: 2 })
        .where(and(eq(translationValue.idTranslationValue, valueId), eq(translationValue.version, 1)))
    })

    await lockerAcquiredLock

    // saveTranslations()'s own SELECT (no FOR UPDATE) is non-blocking under
    // READ COMMITTED, so it reads version 1 (the locker hasn't committed
    // yet), passes its early JS check, and then blocks on its own
    // predicate-guarded `UPDATE ... WHERE version = 1` — because the locker
    // above is holding the row lock.
    const racerPromise = saveTranslations(saveInput(keyId, {
      values: [{ languageCode: 'it', value: 'Ciao ormai vecchio', version: 1 }],
    }))

    // See the identical rationale on the keyVersion race test above: a short,
    // generous fixed delay is the standard, reliable technique for "give the
    // other side time to reach its blocked state" here.
    await new Promise(resolve => setTimeout(resolve, 300))
    releaseLocker()

    const [stale] = await Promise.all([racerPromise, lockerDone])

    expect(stale.ok).toBe(false)
    expect(!stale.ok && 'conflicts' in stale ? stale.conflicts : null).toEqual([
      { languageCode: 'it', currentValue: 'Ciao concorrente', attemptedValue: 'Ciao ormai vecchio' },
    ])

    const [finalValueRow] = await db.select().from(translationValue).where(eq(translationValue.idTranslationKey, keyId))
    // The locker's write won; the racer's blocked UPDATE found 0 matching
    // rows once it unblocked and was correctly rejected, not silently lost.
    expect(finalValueRow.value).toBe('Ciao concorrente')
    expect(finalValueRow.version).toBe(2)
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
