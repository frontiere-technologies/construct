import { describe, expect, it } from 'vitest'
import { usersGridQuerySchema } from './users-grid-query-schema'

const validQuery = {
  page: 0,
  size: 50,
  nameSearch: { operator: 'AND', conditions: ['Mario', 'Rossi'] },
  emailSearch: 'mario@frontiere.it',
  roleIds: [1, 2],
  statuses: [1, 2],
  createdFrom: '2026-07-01',
  createdTo: '2026-07-15',
  updatedFrom: '2026-07-16',
  updatedTo: '2026-07-30',
  sort: 'email',
  direction: 'ASC',
}

describe('usersGridQuerySchema', () => {
  it.each([
    ['a malformed updated-to date', { ...validQuery, updatedTo: 'not-a-date' }],
    ['an impossible calendar date', { ...validQuery, updatedTo: '2026-02-30' }],
    ['a non-finite role id', { ...validQuery, roleIds: [Number.NaN] }],
    ['null in an optional filter field', { ...validQuery, updatedTo: null }],
  ])('rejects %s', (_label, payload) => {
    expect(usersGridQuerySchema.safeParse(payload).success).toBe(false)
  })

  it('accepts a complete valid query and omitted optional filters', () => {
    expect(usersGridQuerySchema.safeParse(validQuery).success).toBe(true)
    expect(usersGridQuerySchema.safeParse({ page: 0, size: 50, sort: 'dateIns', direction: 'DESC' }).success).toBe(true)
  })
})
