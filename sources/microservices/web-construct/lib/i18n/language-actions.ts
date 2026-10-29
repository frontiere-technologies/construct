'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordPlatformAudit } from '@/lib/audit/platform-audit'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { withGlobal, type GlobalTx } from '@/lib/db/tenant-db'
import { appLanguage } from '@/lib/db/schema'
import { invalidateDictionary, refreshLanguageVersions } from './dictionary-service'
import {
  assertCanDeactivate, assertCanDelete, assertCanSetDefault,
  languageInputSchema, type LanguageInput,
} from './language-rules'

export interface ActionResult { error: string | null }

/**
 * drizzle-orm 0.45.2 wraps every driver error before it escapes
 * (`drizzle-orm/pg-core/session.js`'s `catch (e) { throw new
 * DrizzleQueryError(queryString, params, e) }`): `DrizzleQueryError` only
 * carries `query`/`params`/`cause`, never `constraint_name`. The real
 * postgres.js `PostgresError` — with `code` and `constraint_name` — lives at
 * `.cause`. Walked as a loop rather than assumed to be exactly one level
 * deep, since that wrapping depth is an implementation detail (same
 * reasoning, and the same helper, as `translation-actions.ts`'s
 * `findPgError`; verified directly against the real driver here too — a
 * bare `err.message.includes('app_language_code_key')` check on the
 * top-level `DrizzleQueryError` never matches, since its `.message` is just
 * the SQL text and params, never the constraint name).
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

/** Unique/check-violation on `code`, `locale` or the default-language invariants → a message the admin can act on. */
function describe(err: unknown, fallback: string): string {
  const constraint = findPgError(err)?.constraint_name
  if (constraint === 'app_language_code_key') return 'Esiste già una lingua con questo codice.'
  if (constraint === 'app_language_locale_key') return 'Esiste già una lingua con questo locale.'
  if (constraint === 'app_language_single_default') return 'Esiste già una lingua predefinita.'
  if (constraint === 'app_language_default_is_active') return 'La lingua predefinita deve restare attiva.'
  const message = err instanceof Error ? err.message : String(err)
  return `${fallback} ${message}`
}

async function loadRow(tx: GlobalTx, id: number) {
  const [row] = await tx.select().from(appLanguage).where(eq(appLanguage.idLanguage, id)).limit(1)
  if (!row) throw new Error('Lingua non trovata.')
  return row
}

export async function createLanguage(input: LanguageInput): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  const parsed = languageInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    // isDefault is not part of the input on purpose: promoting a language is a
    // separate, atomic operation (setDefaultLanguage). Accepting it here would
    // be exactly the mass-assignment hole §13.3 warns about.
    await withGlobal(async tx => {
      const [created] = await tx.insert(appLanguage).values({
        code: parsed.data.code,
        locale: parsed.data.locale,
        name: parsed.data.name,
        nativeName: parsed.data.nativeName,
        isActive: parsed.data.isActive,
        isDefault: false,
      }).returning({ id: appLanguage.idLanguage })
      // La voce è nella stessa transazione della modifica (MT5-DEC-15) e va nel registro della piattaforma (MT5-DEC-24).
      await recordPlatformAudit(tx, auditActorOf(actor), {
        operation: 'language.create', objectType: 'language', objectId: Number(created.id), details: { code: parsed.data.code },
      })
    })
  } catch (err) {
    return { error: describe(err, 'Impossibile creare la lingua.') }
  }
  refreshLanguageVersions()
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function updateLanguage(id: number, input: LanguageInput): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  const parsed = languageInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    const row = await withGlobal(async tx => {
      const row = await loadRow(tx, id)
      if (row.isActive && !parsed.data.isActive) assertCanDeactivate({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
      await tx.update(appLanguage).set({
        code: parsed.data.code,
        locale: parsed.data.locale,
        name: parsed.data.name,
        nativeName: parsed.data.nativeName,
        isActive: parsed.data.isActive,
      }).where(eq(appLanguage.idLanguage, id))
      await recordPlatformAudit(tx, auditActorOf(actor), {
        operation: 'language.update', objectType: 'language', objectId: id,
        details: {
          before: { code: row.code, locale: row.locale, name: row.name, nativeName: row.nativeName, isActive: row.isActive },
          after: parsed.data,
        },
      })
      return row
    })
    invalidateDictionary(row.code)
    invalidateDictionary(parsed.data.code)
  } catch (err) {
    return { error: describe(err, 'Impossibile aggiornare la lingua.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function setLanguageActive(id: number, isActive: boolean): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  try {
    const row = await withGlobal(async tx => {
      const row = await loadRow(tx, id)
      if (!isActive) assertCanDeactivate({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
      await tx.update(appLanguage).set({ isActive }).where(eq(appLanguage.idLanguage, id))
      await recordPlatformAudit(tx, auditActorOf(actor), {
        operation: 'language.active', objectType: 'language', objectId: id, details: { code: row.code, isActive },
      })
      return row
    })
    invalidateDictionary(row.code)
  } catch (err) {
    return { error: describe(err, 'Impossibile aggiornare lo stato della lingua.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function setDefaultLanguage(id: number): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  try {
    await withGlobal(async tx => {
      const row = await loadRow(tx, id)
      assertCanSetDefault({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
      // Single statement, single transaction: the old default is cleared and the
      // new one set inside one plpgsql body, so the "exactly one default"
      // invariant is never observable as violated (§2.3).
      await tx.execute(sql`select public.set_default_language(${id})`)
      await recordPlatformAudit(tx, auditActorOf(actor), {
        operation: 'language.default', objectType: 'language', objectId: id, details: { code: row.code },
      })
    })
    invalidateDictionary()
  } catch (err) {
    return { error: describe(err, 'Impossibile impostare la lingua predefinita.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function deleteLanguage(id: number): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  try {
    const row = await withGlobal(async tx => {
      const row = await loadRow(tx, id)
      assertCanDelete({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
      // translation_value cascades; users.id_language is ON DELETE SET NULL, so
      // anyone who had picked this language falls back to the default (§6.2).
      await tx.delete(appLanguage).where(eq(appLanguage.idLanguage, id))
      await recordPlatformAudit(tx, auditActorOf(actor), {
        operation: 'language.delete', objectType: 'language', objectId: id, details: { code: row.code },
      })
      return row
    })
    invalidateDictionary(row.code)
  } catch (err) {
    return { error: describe(err, 'Impossibile eliminare la lingua.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}
