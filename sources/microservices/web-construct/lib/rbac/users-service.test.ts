import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyUserFilters } from './users-service'
import type { UsersQuery } from './types'

const dialect = new PgDialect()
function render(query: UsersQuery, ids: string[] | null) {
  return applyUserFilters(query, ids).map(c => dialect.sqlToQuery(c))
}

const baseQuery: UsersQuery = { page: 0, size: 10 }

describe('applyUserFilters', () => {
  it('applies gte on created_at when createdFrom is set', () => {
    const [rendered] = render({ ...baseQuery, createdFrom: '2026-06-01' }, null)
    expect(rendered.sql).toContain('"users"."created_at" >=')
    expect(rendered.params).toEqual(['2026-06-01'])
  })

  it('applies lt on created_at with the next-day value when createdTo is set, to include the full end day', () => {
    const [rendered] = render({ ...baseQuery, createdTo: '2026-06-30' }, null)
    expect(rendered.sql).toContain('"users"."created_at" <')
    expect(rendered.params).toEqual(['2026-07-01'])
  })

  it('applies in(id_user_status) when statuses is set', () => {
    const [rendered] = render({ ...baseQuery, statuses: [2] }, null)
    expect(rendered.sql).toContain('"users"."id_user_status"')
    expect(rendered.params).toEqual([2])
  })

  it('applies in(id) when a candidate id list is passed', () => {
    const [rendered] = render(baseQuery, ['abc', 'def'])
    expect(rendered.sql).toContain('"users"."id"')
    expect(rendered.params).toEqual(['abc', 'def'])
  })

  it('applies nothing when no filters are set', () => {
    expect(applyUserFilters(baseQuery, null)).toEqual([])
  })
})
