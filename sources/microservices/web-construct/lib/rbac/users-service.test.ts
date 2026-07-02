import { describe, it, expect } from 'vitest'
import { applyUserFilters } from './users-service'
import type { UsersQuery } from './types'

interface Call { method: string; args: unknown[] }

function makeFakeQuery() {
  const calls: Call[] = []
  const q = {
    calls,
    ilike(...args: unknown[]) { calls.push({ method: 'ilike', args }); return q },
    or(...args: unknown[]) { calls.push({ method: 'or', args }); return q },
    in(...args: unknown[]) { calls.push({ method: 'in', args }); return q },
    gte(...args: unknown[]) { calls.push({ method: 'gte', args }); return q },
    lte(...args: unknown[]) { calls.push({ method: 'lte', args }); return q },
    lt(...args: unknown[]) { calls.push({ method: 'lt', args }); return q },
  }
  return q
}

const baseQuery: UsersQuery = { page: 0, size: 10 }

describe('applyUserFilters', () => {
  it('applies gte on created_at when createdFrom is set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, createdFrom: '2026-06-01' }, null)
    expect(q.calls).toEqual([{ method: 'gte', args: ['created_at', '2026-06-01'] }])
  })

  it('applies lt on created_at with the next-day value when createdTo is set, to include the full end day', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, createdTo: '2026-06-30' }, null)
    expect(q.calls).toEqual([{ method: 'lt', args: ['created_at', '2026-07-01'] }])
  })

  it('applies in(id_user_status) when statuses is set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, statuses: [2] }, null)
    expect(q.calls).toEqual([{ method: 'in', args: ['id_user_status', [2]] }])
  })

  it('applies in(id) when a candidate id list is passed', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, baseQuery, ['abc', 'def'])
    expect(q.calls).toEqual([{ method: 'in', args: ['id', ['abc', 'def']] }])
  })

  it('applies nothing when no filters are set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, baseQuery, null)
    expect(q.calls).toEqual([])
  })
})
