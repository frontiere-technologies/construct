import { describe, it, expect } from 'vitest'
import { nextDay } from './date-utils'

describe('nextDay', () => {
  it('returns the next calendar day', () => {
    expect(nextDay('2026-06-30')).toBe('2026-07-01')
  })

  it('rolls over month boundaries', () => {
    expect(nextDay('2026-01-31')).toBe('2026-02-01')
  })

  it('rolls over year boundaries', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
