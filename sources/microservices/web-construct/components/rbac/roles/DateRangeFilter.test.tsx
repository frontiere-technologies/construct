import { describe, it, expect } from 'vitest'
import { toIso, fromIso } from './DateRangeFilter'

describe('toIso', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(toIso(new Date(2026, 5, 30))).toBe('2026-06-30')
  })
  it('returns null for undefined', () => {
    expect(toIso(undefined)).toBeNull()
  })
})

describe('fromIso', () => {
  it('parses a YYYY-MM-DD string into a Date', () => {
    const d = fromIso('2026-06-30')
    expect(d).toBeInstanceOf(Date)
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(5)
    expect(d?.getDate()).toBe(30)
  })
  it('returns undefined for null', () => {
    expect(fromIso(null)).toBeUndefined()
  })
  it('returns undefined for an invalid string', () => {
    expect(fromIso('not-a-date')).toBeUndefined()
  })
})
