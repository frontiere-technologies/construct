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
    lt(column: string, value: unknown) { calls.push({ method: 'lt', column, value }); return q },
  }
  return q
}

const baseQuery: RolesQuery = { page: 0, size: 10 }

describe('applyFilters', () => {
  it('applies eq(has_permissions, false) when hasPermission is explicitly false', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, hasPermission: false })
    expect(q.calls).toEqual([{ method: 'eq', column: 'has_permissions', value: false }])
  })

  it('omits the has_permissions filter when hasPermission is undefined', () => {
    const q = makeFakeQuery()
    applyFilters(q, baseQuery)
    expect(q.calls).toEqual([])
  })

  it('combines with existing search and hasPermission filters', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, search: 'Admin', hasPermission: true })
    expect(q.calls).toEqual([
      { method: 'ilike', column: 'description', value: '%Admin%' },
      { method: 'eq', column: 'has_permissions', value: true },
    ])
  })

  it('applies gte on date_ins when startDateIns is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, startDateIns: '2026-06-01' })
    expect(q.calls).toEqual([{ method: 'gte', column: 'date_ins', value: '2026-06-01' }])
  })

  it('applies lt on date_ins with next-day value when endDateIns is set, to include the full end day', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, endDateIns: '2026-06-30' })
    expect(q.calls).toEqual([{ method: 'lt', column: 'date_ins', value: '2026-07-01' }])
  })

  it('applies both gte and lt in order when startDateIns and endDateIns are both set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, startDateIns: '2026-06-01', endDateIns: '2026-06-30' })
    expect(q.calls).toEqual([
      { method: 'gte', column: 'date_ins', value: '2026-06-01' },
      { method: 'lt', column: 'date_ins', value: '2026-07-01' },
    ])
  })

  it('rolls over to the next year when endDateIns is the last day of the year', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, endDateIns: '2026-12-31' })
    expect(q.calls).toEqual([{ method: 'lt', column: 'date_ins', value: '2027-01-01' }])
  })
})
