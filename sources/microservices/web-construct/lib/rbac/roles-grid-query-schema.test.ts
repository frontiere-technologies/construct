import { describe, expect, it } from 'vitest'
import { rolesGridQuerySchema } from './roles-grid-query-schema'

const validQuery = {
  page: 0,
  size: 50,
  search: { operator: 'OR', conditions: ['admin', 'service'] },
  hasPermission: false,
  idMin: 10,
  idMax: 20,
  associatedUsersMin: 3,
  associatedUsersMax: 3,
  startDateIns: '2026-06-01',
  endDateIns: '2026-06-30',
  startDateMod: '2026-07-01',
  endDateMod: '2026-07-30',
  sort: 'dateMod',
  direction: 'DESC',
}

describe('rolesGridQuerySchema', () => {
  it.each([
    ['a non-finite numeric range bound', { ...validQuery, idMin: Number.NaN }],
    ['a zero page size', { ...validQuery, size: 0 }],
    ['an inverted ID range', { ...validQuery, idMin: 20, idMax: 10 }],
    ['an inverted associated-users range', { ...validQuery, associatedUsersMin: 4, associatedUsersMax: 3 }],
    ['a malformed updated date', { ...validQuery, endDateMod: 'not-a-date' }],
    ['an impossible calendar date', { ...validQuery, startDateIns: '2026-02-30' }],
    ['an inverted created-date range', { ...validQuery, startDateIns: '2026-07-31', endDateIns: '2026-07-01' }],
    ['an inverted updated-date range', { ...validQuery, startDateMod: '2026-07-31', endDateMod: '2026-07-01' }],
    ['the terminal created upper date', { ...validQuery, endDateIns: '9999-12-31' }],
    ['the terminal updated upper date', { ...validQuery, endDateMod: '9999-12-31' }],
    ['a malformed text search', { ...validQuery, search: { operator: 'XOR', conditions: ['admin'] } }],
    ['a non-boolean permission filter', { ...validQuery, hasPermission: 'false' }],
    ['an invalid sort field', { ...validQuery, sort: 'name' }],
  ])('rejects %s', (_label, payload) => {
    expect(rolesGridQuerySchema.safeParse(payload).success).toBe(false)
  })

  it('accepts the terminal date as a lower bound', () => {
    expect(rolesGridQuerySchema.safeParse({ page: 0, size: 50, startDateIns: '9999-12-31' }).success).toBe(true)
  })

  it('accepts a complete query and omitted optional filters', () => {
    expect(rolesGridQuerySchema.safeParse(validQuery).success).toBe(true)
    expect(rolesGridQuerySchema.safeParse({ page: 0, size: 50, sort: 'id', direction: 'ASC' }).success).toBe(true)
  })
})
