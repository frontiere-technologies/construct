import { describe, it, expect } from 'vitest'
import { applyFilters } from './roles-service'
import type { RolesQuery } from './types'

interface Call { method: string; column: string; value: unknown }

function makeFakeQuery() {
  const calls: Call[] = []
  const q = {
    calls,
    ilike(column: string, value: unknown) { calls.push({ method: 'ilike', column, value }); return q },
    eq(column: string, value: unknown) { calls.push({ method: 'eq', column, value }); return q },
    gte(column: string, value: unknown) { calls.push({ method: 'gte', column, value }); return q },
    lte(column: string, value: unknown) { calls.push({ method: 'lte', column, value }); return q },
  }
  return q
}

const baseQuery: RolesQuery = { page: 0, size: 10 }

describe('applyFilters', () => {
  it('applies gte/lte on associated_users when min and max are set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, minAssociatedUsers: 5, maxAssociatedUsers: 20 })
    expect(q.calls).toEqual([
      { method: 'gte', column: 'associated_users', value: 5 },
      { method: 'lte', column: 'associated_users', value: 20 },
    ])
  })

  it('applies only gte when only min is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, minAssociatedUsers: 5 })
    expect(q.calls).toEqual([{ method: 'gte', column: 'associated_users', value: 5 }])
  })

  it('applies only lte when only max is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, maxAssociatedUsers: 20 })
    expect(q.calls).toEqual([{ method: 'lte', column: 'associated_users', value: 20 }])
  })

  it('omits associated_users filters when neither min nor max is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, baseQuery)
    expect(q.calls).toEqual([])
  })

  it('combines with existing search and hasPermission filters', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, search: 'Admin', hasPermission: true, minAssociatedUsers: 1 })
    expect(q.calls).toEqual([
      { method: 'ilike', column: 'description', value: '%Admin%' },
      { method: 'eq', column: 'has_permissions', value: true },
      { method: 'gte', column: 'associated_users', value: 1 },
    ])
  })
})
