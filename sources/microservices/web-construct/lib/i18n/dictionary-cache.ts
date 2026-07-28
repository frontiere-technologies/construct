import type { Dictionary } from './types'

export interface CacheEntry {
  version: number
  dict: Dictionary
}

/**
 * `app_language.dictionary_version` only ever increases (a trigger bumps it),
 * so an entry is stale exactly when it is *behind* the current version.
 */
export function isStale(entry: CacheEntry | undefined, version: number): boolean {
  return !entry || entry.version < version
}

/**
 * Process-local dictionary cache, one entry per language.
 *
 * Deliberately not an LRU: the number of languages is bounded by the admin UI
 * (a handful), and each dictionary is a flat string map of a few hundred
 * entries. Freshness comes from the version check, not from expiry.
 */
export class DictionaryStore {
  private entries = new Map<string, CacheEntry>()

  get(code: string, version: number): Dictionary | undefined {
    const entry = this.entries.get(code)
    return isStale(entry, version) ? undefined : entry!.dict
  }

  set(code: string, version: number, dict: Dictionary): void {
    this.entries.set(code, { version, dict })
  }

  /** Drop one language's dictionary, or all of them when `code` is omitted. */
  invalidate(code?: string): void {
    if (code === undefined) this.entries.clear()
    else this.entries.delete(code)
  }

  size(): number {
    return this.entries.size
  }
}
