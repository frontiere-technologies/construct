import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appLanguage, translationKey, translationValue } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { DictionaryStore } from './dictionary-cache'
import { getDefaultLanguage } from './language-service'
import type { Dictionary } from './types'

const log = createLogger('i18n-dictionary')

const store = new DictionaryStore()

/**
 * Dictionary versions are read from a two-column scan of a table with a handful
 * of rows — cheap enough to poll, far cheaper than reloading the dictionaries.
 * The short TTL bounds how long a *different* pod can serve a stale dictionary
 * after an admin edit; the pod that made the edit invalidates itself
 * synchronously, so the admin sees their own change immediately.
 */
const VERSION_TTL_MS = 15_000
let versionCache: { versions: Map<string, number>; expiresAt: number } | null = null

async function getVersions(): Promise<Map<string, number>> {
  const now = Date.now()
  if (versionCache && versionCache.expiresAt > now) return versionCache.versions
  try {
    const rows = await db
      .select({ code: appLanguage.code, version: appLanguage.dictionaryVersion })
      .from(appLanguage)
    const versions = new Map(rows.map(r => [r.code, Number(r.version)]))
    versionCache = { versions, expiresAt: now + VERSION_TTL_MS }
    return versions
  } catch (err) {
    log.error({ err }, 'failed to read dictionary versions — reusing the last known ones')
    return versionCache?.versions ?? new Map()
  }
}

async function loadDictionary(code: string): Promise<Dictionary> {
  const rows = await db
    .select({ key: translationKey.key, value: translationValue.value })
    .from(translationValue)
    .innerJoin(translationKey, eq(translationKey.idTranslationKey, translationValue.idTranslationKey))
    .innerJoin(appLanguage, eq(appLanguage.idLanguage, translationValue.idLanguage))
    .where(eq(appLanguage.code, code))
    .orderBy(asc(translationKey.key))

  const dict: Dictionary = {}
  for (const row of rows) dict[row.key] = row.value
  return dict
}

/**
 * One aggregated load per language per version (§11.4) — never a query per
 * `t()` call, never a request per label. The DB stays the authority: a cache
 * miss or a cache error always ends in a fresh read, and a read failure yields
 * an empty dictionary so the translator falls back instead of throwing.
 */
export async function getDictionary(code: string, namespace?: string): Promise<Dictionary> {
  const versions = await getVersions()
  const version = versions.get(code) ?? 0

  let dict = store.get(code, version)
  if (!dict) {
    try {
      dict = await loadDictionary(code)
      store.set(code, version, dict)
    } catch (err) {
      log.error({ err, code }, 'failed to load dictionary')
      dict = {}
    }
  }

  if (!namespace) return dict
  const prefix = `${namespace}.`
  return Object.fromEntries(Object.entries(dict).filter(([key]) => key.startsWith(prefix)))
}

/** The active language's dictionary plus the default one behind it (§7.2). */
export async function getDictionaryBundle(code: string): Promise<{ dict: Dictionary; defaultDict: Dictionary }> {
  const defaultLanguage = await getDefaultLanguage()
  if (defaultLanguage.code === code) {
    const dict = await getDictionary(code)
    return { dict, defaultDict: dict }
  }
  const [dict, defaultDict] = await Promise.all([
    getDictionary(code),
    getDictionary(defaultLanguage.code),
  ])
  return { dict, defaultDict }
}

/**
 * Drop this pod's cached dictionary for `code` (all of them when omitted) and
 * force the next version read to hit the database. Called by the admin actions
 * right after a write so the admin never sees their own stale copy.
 */
export function invalidateDictionary(code?: string): void {
  store.invalidate(code)
  versionCache = null
}
