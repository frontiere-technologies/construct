import { describe, expect, it } from 'vitest'
import { languagesGridQuerySchema } from './languages-grid-query-schema'

const validQuery = {
  page: 0,
  size: 50,
  codeSearch: { operator: 'AND', conditions: ['i', 't'] },
  localeSearch: 'IT',
  nameSearch: 'Italian',
  nativeNameSearch: 'Italiano',
  isActive: true,
  isDefault: false,
  translatedMin: 10,
  translatedMax: 20,
  missingMin: 2,
  missingMax: 3,
  createdFrom: '2026-07-01',
  createdTo: '2026-07-30',
  sort: 'nativeName',
  direction: 'DESC',
}

describe('languagesGridQuerySchema', () => {
  it('accepts a complete valid query and omitted optional filters', () => {
    expect(languagesGridQuerySchema.safeParse(validQuery).success).toBe(true)
    expect(languagesGridQuerySchema.safeParse({ page: 0, size: 50 }).success).toBe(true)
  })

  it.each([
    ['an impossible date', { ...validQuery, createdTo: '2026-02-30' }],
    ['a malformed date', { ...validQuery, createdFrom: 'July 1' }],
    ['a non-finite number', { ...validQuery, translatedMin: Number.NaN }],
    ['a fractional count', { ...validQuery, missingMax: 1.5 }],
    ['a negative count', { ...validQuery, missingMin: -1 }],
    ['an invalid boolean', { ...validQuery, isActive: 'true' }],
    ['an invalid sort', { ...validQuery, sort: '__proto__' }],
    ['an invalid direction', { ...validQuery, direction: 'UP' }],
    ['an inverted translated range', { ...validQuery, translatedMin: 21, translatedMax: 20 }],
    ['an inverted missing range', { ...validQuery, missingMin: 4, missingMax: 3 }],
    ['an inverted created range', { ...validQuery, createdFrom: '2026-07-31', createdTo: '2026-07-01' }],
    ['zero page size', { ...validQuery, size: 0 }],
    ['an oversized page', { ...validQuery, size: 201 }],
  ])('rejects %s', (_label, payload) => {
    expect(languagesGridQuerySchema.safeParse(payload).success).toBe(false)
  })
})
