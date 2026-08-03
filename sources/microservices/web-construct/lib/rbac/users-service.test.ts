import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyUserFilters } from './users-service'
import type { UsersQuery } from './types'

const dialect = new PgDialect()
function render(query: UsersQuery, roleIds: number[] | undefined) {
  return applyUserFilters(query, roleIds).map(c => dialect.sqlToQuery(c))
}

const baseQuery: UsersQuery = { page: 0, size: 10 }

describe('applyUserFilters', () => {
  it('applies gte on created_at when createdFrom is set', () => {
    const [rendered] = render({ ...baseQuery, createdFrom: '2026-06-01' }, undefined)
    expect(rendered.sql).toContain('"users"."created_at" >=')
    expect(rendered.params).toEqual(['2026-06-01'])
  })

  it('applies lt on created_at with the next-day value when createdTo is set, to include the full end day', () => {
    const [rendered] = render({ ...baseQuery, createdTo: '2026-06-30' }, undefined)
    expect(rendered.sql).toContain('"users"."created_at" <')
    expect(rendered.params).toEqual(['2026-07-01'])
  })

  it('applies in(id_user_status) when statuses is set', () => {
    const [rendered] = render({ ...baseQuery, statuses: [2] }, undefined)
    expect(rendered.sql).toContain('"users"."id_user_status"')
    expect(rendered.params).toEqual([2])
  })

  it('filters roles with a correlated EXISTS query instead of materializing user IDs', () => {
    const [rendered] = render(baseQuery, [1, 2])
    expect(rendered.sql).toContain('exists (select')
    expect(rendered.sql).toContain('"user_role"')
    expect(rendered.params).toEqual([1, 2])
  })

  it('applies nothing when no filters are set', () => {
    expect(applyUserFilters(baseQuery, undefined)).toEqual([])
  })

  it('joins compound text conditions with AND', () => {
    const [rendered] = render({
      ...baseQuery,
      nameSearch: { operator: 'AND', conditions: ['mario', 'frontiere'] },
    }, undefined)

    expect(rendered.sql).toContain(') and (')
    expect(rendered.params).toEqual([
      '%mario%', '%mario%',
      '%frontiere%', '%frontiere%',
    ])
  })

  it('joins compound text conditions with OR', () => {
    const [rendered] = render({
      ...baseQuery,
      nameSearch: { operator: 'OR', conditions: ['mario', 'luigi'] },
    }, undefined)

    expect(rendered.sql).toContain(') or (')
    expect(rendered.params).toEqual([
      '%mario%', '%mario%',
      '%luigi%', '%luigi%',
    ])
  })

  it('applies name only to first/last name and email only to email', () => {
    const rendered = render({
      ...baseQuery,
      nameSearch: 'Mario', emailSearch: 'frontiere.it', updatedFrom: '2026-07-01',
    }, undefined)

    expect(rendered[0].sql).toContain('"users"."first_name"')
    expect(rendered[0].sql).toContain('"users"."last_name"')
    expect(rendered[0].sql).not.toContain('"users"."email"')
    expect(rendered[1].sql).toContain('"users"."email"')
    expect(rendered[1].sql).not.toContain('"users"."first_name"')
    expect(rendered[2].sql).toContain('"users"."updated_at" >=')
  })

  it('treats LIKE metacharacters literally in a name contains filter', () => {
    const [rendered] = render({ ...baseQuery, nameSearch: String.raw`100%_\ready` }, undefined)

    expect(rendered.sql).toContain("escape '\\'")
    expect(rendered.params).toEqual([String.raw`%100\%\_\\ready%`, String.raw`%100\%\_\\ready%`])
  })

  it('includes the full updated-to day with its next-day exclusive boundary', () => {
    const [rendered] = render({ ...baseQuery, updatedTo: '2026-07-30' }, undefined)

    expect(rendered.sql).toContain('"users"."updated_at" <')
    expect(rendered.params).toEqual(['2026-07-31'])
  })

  it.each([
    ['createdTo', 'createdTo exceeds the supported inclusive upper bound'],
    ['updatedTo', 'updatedTo exceeds the supported inclusive upper bound'],
  ] as const)('rejects terminal %s before building next-day SQL', (field, message) => {
    expect(() => applyUserFilters({ ...baseQuery, [field]: '9999-12-31' }, undefined))
      .toThrowError(message)
  })

  it.each([
    ['createdFrom', 'created_at'],
    ['updatedFrom', 'updated_at'],
  ] as const)('keeps terminal %s valid as an inclusive lower SQL bound', (field, column) => {
    const [rendered] = render({ ...baseQuery, [field]: '9999-12-31' }, undefined)

    expect(rendered.sql).toContain(`"users"."${column}" >=`)
    expect(rendered.params).toEqual(['9999-12-31'])
  })
})
