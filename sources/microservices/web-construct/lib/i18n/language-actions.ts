'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { appLanguage } from '@/lib/db/schema'
import { auditI18n } from './audit'
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

async function loadRow(id: number) {
  const [row] = await db.select().from(appLanguage).where(eq(appLanguage.idLanguage, id)).limit(1)
  if (!row) throw new Error('Lingua non trovata.')
  return row
}

export async function createLanguage(input: LanguageInput): Promise<ActionResult> {
  await requireAdmin()
  const parsed = languageInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    // isDefault is not part of the input on purpose: promoting a language is a
    // separate, atomic operation (setDefaultLanguage). Accepting it here would
    // be exactly the mass-assignment hole §13.3 warns about.
    const [created] = await db.insert(appLanguage).values({
      code: parsed.data.code,
      locale: parsed.data.locale,
      name: parsed.data.name,
      nativeName: parsed.data.nativeName,
      isActive: parsed.data.isActive,
      isDefault: false,
    }).returning({ id: appLanguage.idLanguage })
    await auditI18n('language.create', { languageId: Number(created.id), code: parsed.data.code })
  } catch (err) {
    return { error: describe(err, 'Impossibile creare la lingua.') }
  }
  refreshLanguageVersions()
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function updateLanguage(id: number, input: LanguageInput): Promise<ActionResult> {
  await requireAdmin()
  const parsed = languageInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    const row = await loadRow(id)
    if (row.isActive && !parsed.data.isActive) assertCanDeactivate({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
    await db.update(appLanguage).set({
      code: parsed.data.code,
      locale: parsed.data.locale,
      name: parsed.data.name,
      nativeName: parsed.data.nativeName,
      isActive: parsed.data.isActive,
    }).where(eq(appLanguage.idLanguage, id))
    await auditI18n('language.update', {
      languageId: id,
      before: { code: row.code, locale: row.locale, name: row.name, nativeName: row.nativeName, isActive: row.isActive },
      after: parsed.data,
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
  await requireAdmin()
  try {
    const row = await loadRow(id)
    if (!isActive) assertCanDeactivate({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
    await db.update(appLanguage).set({ isActive }).where(eq(appLanguage.idLanguage, id))
    await auditI18n(isActive ? 'language.activate' : 'language.deactivate', { languageId: id, code: row.code })
    invalidateDictionary(row.code)
  } catch (err) {
    return { error: describe(err, 'Impossibile aggiornare lo stato della lingua.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function setDefaultLanguage(id: number): Promise<ActionResult> {
  await requireAdmin()
  try {
    const row = await loadRow(id)
    assertCanSetDefault({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
    // Single statement, single transaction: the old default is cleared and the
    // new one set inside one plpgsql body, so the "exactly one default"
    // invariant is never observable as violated (§2.3).
    await db.execute(sql`select public.set_default_language(${id})`)
    await auditI18n('language.set_default', { languageId: id, code: row.code })
    invalidateDictionary()
  } catch (err) {
    return { error: describe(err, 'Impossibile impostare la lingua predefinita.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function deleteLanguage(id: number): Promise<ActionResult> {
  await requireAdmin()
  try {
    const row = await loadRow(id)
    assertCanDelete({ isDefault: row.isDefault, isActive: row.isActive, usageCount: 0 })
    // translation_value cascades; users.id_language is ON DELETE SET NULL, so
    // anyone who had picked this language falls back to the default (§6.2).
    await db.delete(appLanguage).where(eq(appLanguage.idLanguage, id))
    await auditI18n('language.delete', { languageId: id, code: row.code })
    invalidateDictionary(row.code)
  } catch (err) {
    return { error: describe(err, 'Impossibile eliminare la lingua.') }
  }
  revalidatePath('/', 'layout')
  return { error: null }
}
