import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyFilters } from './roles-service'
import type { RolesQuery } from './types'

const dialect = new PgDialect()
function render(query: RolesQuery) {
  return applyFilters(query).map(c => dialect.sqlToQuery(c))
}

const baseQuery: RolesQuery = { page: 0, size: 10 }

describe('applyFilters', () => {
  it('applies eq(has_permissions, false) when hasPermission is explicitly false', () => {
    const [rendered] = render({ ...baseQuery, hasPermission: false })
    expect(rendered.sql).toContain('"role_list_view"."has_permissions"')
    expect(rendered.params).toEqual([false])
  })

  it('omits the has_permissions filter when hasPermission is undefined', () => {
    expect(applyFilters(baseQuery)).toEqual([])
  })

  it('combines with existing search and hasPermission filters', () => {
    const rendered = render({ ...baseQuery, search: 'Admin', hasPermission: true })
    expect(rendered).toHaveLength(2)
    expect(rendered[0].sql).toContain('"role_list_view"."description"')
    expect(rendered[0].params).toEqual(['%Admin%'])
    expect(rendered[1].params).toEqual([true])
  })

  it('joins compound text conditions with OR', () => {
    const [rendered] = render({
      ...baseQuery,
      search: { operator: 'OR', conditions: ['Admin', 'Editor'] },
    })

    expect(rendered.sql).toContain(' or ')
    expect(rendered.params).toEqual(['%Admin%', '%Editor%'])
  })

  it('uses inclusive numeric bounds and both inclusive date ranges together', () => {
    const rendered = render({
      ...baseQuery,
      idMin: 10, idMax: 20,
      associatedUsersMin: 3, associatedUsersMax: 3,
      startDateIns: '2026-06-01', endDateIns: '2026-06-30',
      startDateMod: '2026-07-01', endDateMod: '2026-07-30',
    })

    expect(rendered.flatMap(item => item.params)).toEqual([
      10, 20, 3, 3,
      '2026-06-01', '2026-07-01',
      '2026-07-01', '2026-07-31',
    ])
    expect(rendered.map(item => item.sql).join(' ')).toContain('"role_list_view"."id" >=')
    expect(rendered.map(item => item.sql).join(' ')).toContain('"role_list_view"."associated_users" <=')
    expect(rendered.map(item => item.sql).join(' ')).toContain('"role_list_view"."date_mod" <')
  })

  it('applies gte on date_ins when startDateIns is set', () => {
    const [rendered] = render({ ...baseQuery, startDateIns: '2026-06-01' })
    expect(rendered.sql).toContain('"role_list_view"."date_ins" >=')
    expect(rendered.params).toEqual(['2026-06-01'])
  })

  it('applies lt on date_ins with next-day value when endDateIns is set, to include the full end day', () => {
    const [rendered] = render({ ...baseQuery, endDateIns: '2026-06-30' })
    expect(rendered.sql).toContain('"role_list_view"."date_ins" <')
    expect(rendered.params).toEqual(['2026-07-01'])
  })

  it('applies both gte and lt in order when startDateIns and endDateIns are both set', () => {
    const rendered = render({ ...baseQuery, startDateIns: '2026-06-01', endDateIns: '2026-06-30' })
    expect(rendered.map(r => r.params)).toEqual([['2026-06-01'], ['2026-07-01']])
  })

  it('rolls over to the next year when endDateIns is the last day of the year', () => {
    const [rendered] = render({ ...baseQuery, endDateIns: '2026-12-31' })
    expect(rendered.params).toEqual(['2027-01-01'])
  })
})
