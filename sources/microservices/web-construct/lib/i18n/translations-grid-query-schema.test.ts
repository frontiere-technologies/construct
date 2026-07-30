import { describe, expect, it } from 'vitest'
import { translationsGridQuerySchema } from './translations-grid-query-schema'

const validQuery = {
  page: 0,
  size: 50,
  search: { operator: 'AND', conditions: ['common', 'save'] },
  descriptionSearch: 'button',
  valueSearches: { en: { operator: 'OR', conditions: ['save', 'store'] } },
  languageCode: 'en',
  namespace: 'common',
  module: 'actions',
  status: 'missing',
  updatedFrom: '2026-07-01',
  updatedTo: '2026-07-30',
  sort: 'updatedAt',
  direction: 'DESC',
}

describe('translationsGridQuerySchema', () => {
  it('accepts a complete valid query and omitted optional filters', () => {
    expect(translationsGridQuerySchema.safeParse(validQuery).success).toBe(true)
    expect(translationsGridQuerySchema.safeParse({ page: 0, size: 50 }).success).toBe(true)
  })

  it.each([
    ['an impossible date', { updatedTo: '2026-02-30' }],
    ['a malformed date', { updatedFrom: 'July 1' }],
    ['an inverted date range', { updatedFrom: '2026-07-31', updatedTo: '2026-07-01' }],
    ['the unsupported terminal updated-to date', { updatedTo: '9999-12-31' }],
    ['a negative page', { page: -1 }],
    ['a fractional page', { page: 0.5 }],
    ['a zero page size', { size: 0 }],
    ['an oversized page size', { size: 201 }],
    ['an invalid sort', { sort: '__proto__' }],
    ['an invalid direction', { direction: 'UP' }],
    ['an invalid status', { status: 'partial' }],
    ['an empty text search', { search: '' }],
    ['an invalid compound text search', { search: { operator: 'XOR', conditions: ['save'] } }],
    ['an invalid value search', { valueSearches: { en: { operator: 'AND', conditions: [] } } }],
  ])('rejects %s', (_label, invalid) => {
    expect(translationsGridQuerySchema.safeParse({ ...validQuery, ...invalid }).success).toBe(false)
  })

  it('still accepts the terminal date as a lower bound', () => {
    expect(translationsGridQuerySchema.safeParse({ page: 0, size: 50, updatedFrom: '9999-12-31' }).success).toBe(true)
  })
})
