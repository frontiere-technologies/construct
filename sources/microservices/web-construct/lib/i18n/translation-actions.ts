'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { auditI18n } from './audit'
import { invalidateDictionary } from './dictionary-service'
import { isValidNamespace, isValidTranslationKey } from './key-format'
import {
  MAX_BULK_VALUES, MAX_VALUE_LENGTH,
  type SaveTranslationsInput, type SaveTranslationsResult, type TranslationConflict,
} from './types'

export type KeyActionResult = { error: string | null; id?: number }

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
    invalidateDictionary()
    revalidatePath('/', 'layout')
    return { error: null, id: Number(created.id) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('translation_key_key_key')) return { error: 'Esiste già una chiave con questo nome.' }
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
    if (v.value.length > MAX_VALUE_LENGTH) {
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
            conflicts.push({ languageCode: incoming.languageCode, currentValue: '', currentVersion: 0, attemptedValue: value })
            continue
          }
          if (!value) continue
          await tx.insert(translationValue).values({
            idTranslationKey: input.keyId, idLanguage: languageId, value,
          })
          touchedCodes.add(incoming.languageCode)
          continue
        }

        if (incoming.version === null || existing.version !== incoming.version) {
          conflicts.push({
            languageCode: incoming.languageCode,
            currentValue: existing.value,
            currentVersion: existing.version,
            attemptedValue: value,
          })
          continue
        }

        if (existing.value === value) continue

        if (!value) {
          await tx.delete(translationValue)
            .where(eq(translationValue.idTranslationValue, existing.idTranslationValue))
        } else {
          await tx.update(translationValue)
            .set({ value, version: existing.version + 1 })
            .where(eq(translationValue.idTranslationValue, existing.idTranslationValue))
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
        await tx.update(translationKey).set({
          description: nextDescription,
          namespace: nextNamespace,
          module: nextModule,
          version: keyRow.version + 1,
        }).where(eq(translationKey.idTranslationKey, input.keyId))
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
