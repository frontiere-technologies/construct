import { MAX_KEY_LENGTH } from './types'

/** Mirrors the `translation_key_format` CHECK constraint in schema.sql. */
const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$/
/** Mirrors the `translation_key_namespace_format` CHECK constraint. */
const NAMESPACE_RE = /^[a-z][a-z0-9_]*$/

export function isValidTranslationKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && KEY_RE.test(key)
}

export function isValidNamespace(namespace: string): boolean {
  return namespace.length <= 60 && NAMESPACE_RE.test(namespace)
}

/** The namespace a key belongs to by convention: its first dot-separated segment. */
export function namespaceOf(key: string): string {
  const dot = key.indexOf('.')
  return dot === -1 ? key : key.slice(0, dot)
}
