'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { auditI18n } from './audit'
import { invalidateDictionary, refreshLanguageVersions } from './dictionary-service'
import { isValidNamespace, isValidTranslationKey } from './key-format'
import {
  MAX_BULK_VALUES, MAX_VALUE_LENGTH,
  type SaveTranslationsInput, type SaveTranslationsResult, type TranslationConflict,
} from './types'

export interface KeyActionResult { error: string | null; id?: number }

/** Postgres SQLSTATE for `unique_violation` — see postgres.js's `errorFields` (`67: 'code'`). */
const PG_UNIQUE_VIOLATION = '23505'

/**
 * drizzle-orm 0.45.2 wraps every driver error before it escapes
 * (`drizzle-orm/pg-core/session.js`'s `catch (e) { throw new
 * DrizzleQueryError(queryString, params, e) }`): `DrizzleQueryError` only
 * carries `query`/`params`/`cause`, never `code`. The real postgres.js
 * `PostgresError` — with `code` and `constraint_name` — lives at `.cause`.
 * Walked as a loop rather than assumed to be exactly one level deep, since
 * that wrapping depth is an implementation detail; verified against the real
 * driver (see the "second fix round" section of task-9-report.md) to be one
 * level down in practice.
 */
function findPgError(err: unknown): { code?: string; constraint_name?: string } | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth++) {
    if (typeof current === 'object' && 'code' in current) {
      return current as { code?: string; constraint_name?: string }
    }
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/**
 * Matches on the real Postgres error's SQLSTATE and, for `unique_violation`,
 * its own `constraint_name` field (populated by postgres.js) — not a
 * substring match on any wrapper's `message`, which for a `DrizzleQueryError`
 * is just the SQL text, never the constraint name.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgErr = findPgError(err)
  return pgErr?.code === PG_UNIQUE_VIOLATION && pgErr?.constraint_name === constraint
}

export interface TranslationKeyInput {
  key: string
  description: string | null
  namespace: string
  module: string | null
}

function validateKeyInput(input: TranslationKeyInput): string | null {
  if (!isValidTranslationKey(input.key.trim())) {
    return 'Chiave non valida. Usa il formato modulo.sezione.elemento in minuscolo, senza spazi.'
  }
  if (!isValidNamespace(input.namespace.trim())) {
    return 'Namespace non valido. Usa lettere minuscole, cifre e underscore.'
  }
  if (input.module && !isValidNamespace(input.module.trim())) {
    return 'Modulo non valido. Usa lettere minuscole, cifre e underscore.'
  }
  return null
}

export async function createTranslationKey(input: TranslationKeyInput): Promise<KeyActionResult> {
  await requireAdmin()
  const invalid = validateKeyInput(input)
  if (invalid) return { error: invalid }

  try {
    const [created] = await db.insert(translationKey).values({
      key: input.key.trim(),
      description: input.description?.trim() || null,
      namespace: input.namespace.trim(),
      module: input.module?.trim() || null,
    }).returning({ id: translationKey.idTranslationKey })
    await auditI18n('translation_key.create', { keyId: Number(created.id), key: input.key.trim() })
    // A brand-new key has no values yet, so no cached dictionary is actually
    // stale — the statement-level trigger on translation_key already bumps
    // every `dictionary_version`. Only this pod's version cache needs
    // refreshing so it notices; dropping every cached dictionary would be
    // indiscriminate (same reasoning as `language-actions.ts`'s
    // `refreshLanguageVersions()` calls for `createLanguage`, etc.).
    refreshLanguageVersions()
    revalidatePath('/', 'layout')
    return { error: null, id: Number(created.id) }
  } catch (err) {
    if (isUniqueViolation(err, 'translation_key_key_key')) return { error: 'Esiste già una chiave con questo nome.' }
    const message = err instanceof Error ? err.message : String(err)
    return { error: `Impossibile creare la chiave. ${message}` }
  }
}

export async function deleteTranslationKey(id: number): Promise<{ error: string | null }> {
  await requireAdmin()
  try {
    const [row] = await db.select({ key: translationKey.key }).from(translationKey)
      .where(eq(translationKey.idTranslationKey, id)).limit(1)
    if (!row) return { error: 'Chiave non trovata.' }
    // translation_value rows cascade — the FK is ON DELETE CASCADE.
    await db.delete(translationKey).where(eq(translationKey.idTranslationKey, id))
    await auditI18n('translation_key.delete', { keyId: id, key: row.key })
    invalidateDictionary()
    revalidatePath('/', 'layout')
    return { error: null }
  } catch (err) {
    return { error: `Impossibile eliminare la chiave. ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Save a key's metadata and all of its translated values in one transaction
 * (§13.3), with optimistic locking on both (§14.2).
 *
 * A version mismatch is reported, never overwritten: the caller gets the value
 * that is actually stored plus the value they tried to save, so the admin can
 * decide (§14.3). Because the whole thing is one transaction, a conflict on any
 * single language leaves every other language untouched too.
 */
export async function saveTranslations(input: SaveTranslationsInput): Promise<SaveTranslationsResult> {
  await requireAdmin()

  if (input.values.length > MAX_BULK_VALUES) {
    return { ok: false, error: `Troppe traduzioni in un solo salvataggio (max ${MAX_BULK_VALUES}).` }
  }
  for (const v of input.values) {
    // Trimmed first: the stored form is always trimmed (see below), so a
    // value that only exceeds the limit because of leading/trailing
    // whitespace would otherwise be rejected even though it fits once saved.
    if (v.value.trim().length > MAX_VALUE_LENGTH) {
      return { ok: false, error: `La traduzione per «${v.languageCode}» supera i ${MAX_VALUE_LENGTH} caratteri.` }
    }
  }
  if (!isValidNamespace(input.namespace.trim())) {
    return { ok: false, error: 'Namespace non valido. Usa lettere minuscole, cifre e underscore.' }
  }
  if (input.module && !isValidNamespace(input.module.trim())) {
    return { ok: false, error: 'Modulo non valido. Usa lettere minuscole, cifre e underscore.' }
  }

  const conflicts: TranslationConflict[] = []
  const touchedCodes = new Set<string>()

  try {
    await db.transaction(async tx => {
      const [keyRow] = await tx.select().from(translationKey)
        .where(eq(translationKey.idTranslationKey, input.keyId)).limit(1)
      if (!keyRow) throw new Error('__NOT_FOUND__')
      if (keyRow.version !== input.keyVersion) throw new Error('__KEY_CONFLICT__')

      const languages = await tx.select({ id: appLanguage.idLanguage, code: appLanguage.code })
        .from(appLanguage)
      const idByCode = new Map(languages.map(l => [l.code, Number(l.id)]))

      for (const incoming of input.values) {
        const languageId = idByCode.get(incoming.languageCode)
        if (languageId === undefined) throw new Error(`__UNKNOWN_LANGUAGE__${incoming.languageCode}`)

        const [existing] = await tx.select().from(translationValue)
          .where(and(
            eq(translationValue.idTranslationKey, input.keyId),
            eq(translationValue.idLanguage, languageId),
          )).limit(1)

        const value = incoming.value.trim()

        if (!existing) {
          // A row appearing under us means another admin created it first —
          // that is a conflict, not something to silently merge into.
          if (incoming.version !== null) {
            conflicts.push({ languageCode: incoming.languageCode, currentValue: '', attemptedValue: value })
            continue
          }
          if (!value) continue
          // A savepoint, not just a try/catch: Postgres marks the whole
          // transaction aborted after a constraint violation, so the
          // recovery re-select below would itself fail with `25P02 current
          // transaction is aborted` without rolling back to a point before
          // the failed INSERT first (verified against the real driver — see
          // the "second fix round" section of task-9-report.md).
          await tx.execute(sql`savepoint translation_value_insert`)
          try {
            await tx.insert(translationValue).values({
              idTranslationKey: input.keyId, idLanguage: languageId, value,
            })
            await tx.execute(sql`release savepoint translation_value_insert`)
          } catch (err) {
            // A concurrent *first* insert for this language can race us
            // between the SELECT above (no lock) and this INSERT and win the
            // unique constraint — report it as a conflict, not a raw 500.
            if (isUniqueViolation(err, 'translation_value_key_language_unique')) {
              await tx.execute(sql`rollback to savepoint translation_value_insert`)
              const [nowExisting] = await tx.select().from(translationValue)
                .where(and(
                  eq(translationValue.idTranslationKey, input.keyId),
                  eq(translationValue.idLanguage, languageId),
                )).limit(1)
              conflicts.push({
                languageCode: incoming.languageCode,
                currentValue: nowExisting?.value ?? '',
                attemptedValue: value,
              })
              continue
            }
            throw err
          }
          touchedCodes.add(incoming.languageCode)
          continue
        }

        if (incoming.version === null || existing.version !== incoming.version) {
          conflicts.push({
            languageCode: incoming.languageCode,
            currentValue: existing.value,
            attemptedValue: value,
          })
          continue
        }

        if (existing.value === value) continue

        // The version is part of the WHERE, not just the JS comparison above:
        // under READ COMMITTED a plain SELECT takes no lock, so two admins
        // can both read the same version, one UPDATE/DELETE takes the row
        // lock and commits, and the other's write — re-evaluating the
        // predicate once unblocked — now matches nothing. Zero rows affected
        // is the real conflict signal; the JS check above only short-circuits
        // the common, non-racing case.
        if (!value) {
          const deleted = await tx.delete(translationValue)
            .where(and(
              eq(translationValue.idTranslationValue, existing.idTranslationValue),
              eq(translationValue.version, incoming.version),
            ))
          if (deleted.count === 0) {
            const [nowExisting] = await tx.select().from(translationValue)
              .where(eq(translationValue.idTranslationValue, existing.idTranslationValue)).limit(1)
            conflicts.push({
              languageCode: incoming.languageCode,
              // Not `?? existing.value`: if the competing write deleted the
              // row, there is no current value to show — `''` matches the
              // `!existing` branch's own convention above.
              currentValue: nowExisting?.value ?? '',
              attemptedValue: value,
            })
            continue
          }
        } else {
          const updated = await tx.update(translationValue)
            .set({ value, version: incoming.version + 1 })
            .where(and(
              eq(translationValue.idTranslationValue, existing.idTranslationValue),
              eq(translationValue.version, incoming.version),
            ))
          if (updated.count === 0) {
            const [nowExisting] = await tx.select().from(translationValue)
              .where(eq(translationValue.idTranslationValue, existing.idTranslationValue)).limit(1)
            conflicts.push({
              languageCode: incoming.languageCode,
              // Same convention as the delete branch above: `''`, not the
              // stale pre-write value, if the row is gone by the time we
              // re-read it.
              currentValue: nowExisting?.value ?? '',
              attemptedValue: value,
            })
            continue
          }
        }
        touchedCodes.add(incoming.languageCode)
      }

      if (conflicts.length) throw new Error('__VALUE_CONFLICT__')

      // `keyVersion` guards description/namespace/module only (see the doc
      // comment on `SaveTranslationsInput.keyVersion`) — it must not bump on a
      // save that only touches values. Two admins editing different languages
      // of the same untouched-metadata key both pass the version check above;
      // bumping unconditionally here would make the *second* save fail with a
      // stale-key error instead of the per-language conflict the values loop
      // just computed, since every save would invalidate every other admin's
      // snapshot regardless of what they actually changed.
      const nextDescription = input.description?.trim() || null
      const nextNamespace = input.namespace.trim()
      const nextModule = input.module?.trim() || null
      const metadataChanged =
        nextDescription !== (keyRow.description ?? null) ||
        nextNamespace !== keyRow.namespace ||
        nextModule !== (keyRow.module ?? null)

      if (metadataChanged) {
        // Same READ-COMMITTED race as the per-language writes above: the
        // early `keyRow.version !== input.keyVersion` check only catches the
        // non-racing case. The version has to be in the WHERE for the write
        // itself to be safe against a concurrent metadata update that
        // committed in between.
        const keyUpdated = await tx.update(translationKey).set({
          description: nextDescription,
          namespace: nextNamespace,
          module: nextModule,
          version: keyRow.version + 1,
        }).where(and(
          eq(translationKey.idTranslationKey, input.keyId),
          eq(translationKey.version, input.keyVersion),
        ))
        if (keyUpdated.count === 0) throw new Error('__KEY_CONFLICT__')
      } else if (touchedCodes.size > 0) {
        // Metadata didn't change, so the version-bump guard above correctly
        // left `translation_key` untouched — but that also means the
        // `before update` trigger that stamps `updated_at` never fired, so
        // the grid's "Ultima modifica" column would still show the previous
        // date after a successful value-only save. Move the timestamp
        // without bumping the version: a no-op SET still fires the row
        // trigger (it stamps `updated_at` unconditionally on any UPDATE),
        // and no optimistic-lock predicate is needed here since nothing
        // being guarded by `keyVersion` is being written.
        await tx.update(translationKey)
          .set({ updatedAt: sql`now()` })
          .where(eq(translationKey.idTranslationKey, input.keyId))
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('__VALUE_CONFLICT__')) return { ok: false, conflicts }
    if (message.includes('__KEY_CONFLICT__')) {
      return { ok: false, error: 'La chiave è stata modificata da un altro amministratore. Ricarica i dati e riprova.' }
    }
    if (message.includes('__NOT_FOUND__')) return { ok: false, error: 'Chiave non trovata.' }
    if (message.includes('__UNKNOWN_LANGUAGE__')) return { ok: false, error: 'Lingua non riconosciuta.' }
    return { ok: false, error: `Impossibile salvare le traduzioni. ${message}` }
  }

  await auditI18n('translation_value.save', { keyId: input.keyId, languages: [...touchedCodes] })
  // Only the languages actually written are dropped from the cache (§11.3).
  for (const code of touchedCodes) invalidateDictionary(code)
  revalidatePath('/', 'layout')
  return { ok: true }
}
