import { describe, it, expect } from 'vitest'
import { DictionaryStore, isStale } from './dictionary-cache'

describe('isStale', () => {
  it('treats a missing entry as stale', () => {
    expect(isStale(undefined, 5)).toBe(true)
  })
  it('treats an older version as stale', () => {
    expect(isStale({ version: 4, dict: {} }, 5)).toBe(true)
  })
  it('treats a matching version as fresh', () => {
    expect(isStale({ version: 5, dict: {} }, 5)).toBe(false)
  })
  it('treats a newer cached version as fresh — a version can only move forward', () => {
    expect(isStale({ version: 6, dict: {} }, 5)).toBe(false)
  })
})

describe('DictionaryStore', () => {
  it('returns a stored dictionary when the version still matches', () => {
    const s = new DictionaryStore()
    s.set('it', 1, { a: 'A' })
    expect(s.get('it', 1)).toEqual({ a: 'A' })
  })
  it('returns undefined when the version has moved on', () => {
    const s = new DictionaryStore()
    s.set('it', 1, { a: 'A' })
    expect(s.get('it', 2)).toBeUndefined()
  })
  it('returns undefined for a language it has never seen', () => {
    expect(new DictionaryStore().get('de', 1)).toBeUndefined()
  })
  it('invalidates one language without touching the others', () => {
    const s = new DictionaryStore()
    s.set('it', 1, { a: 'A' })
    s.set('en', 1, { a: 'B' })
    s.invalidate('it')
    expect(s.get('it', 1)).toBeUndefined()
    expect(s.get('en', 1)).toEqual({ a: 'B' })
  })
  it('invalidates every language when called with no argument', () => {
    const s = new DictionaryStore()
    s.set('it', 1, { a: 'A' })
    s.set('en', 1, { a: 'B' })
    s.invalidate()
    expect(s.size()).toBe(0)
  })
  it('overwrites the entry for a language rather than accumulating versions', () => {
    const s = new DictionaryStore()
    s.set('it', 1, { a: 'A' })
    s.set('it', 2, { a: 'B' })
    expect(s.size()).toBe(1)
    expect(s.get('it', 2)).toEqual({ a: 'B' })
  })
})
