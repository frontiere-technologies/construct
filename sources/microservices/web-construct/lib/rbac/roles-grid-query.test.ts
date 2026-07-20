import { describe, it, expect } from 'vitest'
import { buildRolesGridQuery, rolesUrlParamsToFilterModel, rolesFilterModelToSearchParams } from './roles-grid-query'

describe('buildRolesGridQuery', () => {
  it('defaults to page 0, id/ASC sort, no filters', () => {
    expect(buildRolesGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, search: undefined, hasPermission: undefined,
      startDateIns: undefined, endDateIns: undefined, sort: 'id', direction: 'ASC',
    })
  })

  it('computes page from startRow and block size', () => {
    expect(buildRolesGridQuery(150, 50, [], {}).page).toBe(3)
  })

  it('maps text, boolean-enum, and date-range filters plus an explicit sort', () => {
    const q = buildRolesGridQuery(0, 50, [{ colId: 'description', sort: 'desc' }], {
      description: { filter: 'admin' },
      hasPermissions: { value: 'false' },
      dateIns: { dateFrom: '2026-01-01 00:00:00', dateTo: '2026-01-31 00:00:00' },
    })
    expect(q.search).toBe('admin')
    expect(q.hasPermission).toBe(false)
    expect(q.startDateIns).toBe('2026-01-01')
    expect(q.endDateIns).toBe('2026-01-31')
    expect(q.sort).toBe('description')
    expect(q.direction).toBe('DESC')
  })

  it('treats hasPermissions value "true" as boolean true', () => {
    expect(buildRolesGridQuery(0, 50, [], { hasPermissions: { value: 'true' } }).hasPermission).toBe(true)
  })
})

describe('rolesUrlParamsToFilterModel / rolesFilterModelToSearchParams', () => {
  it('produces an empty model when nothing is set', () => {
    expect(rolesUrlParamsToFilterModel({ search: '', hasPermission: null, startDateIns: null, endDateIns: null, sortField: 'id', sortDir: 'ASC' })).toEqual({})
  })

  it('round-trips filter values through both directions', () => {
    const model = rolesUrlParamsToFilterModel({ search: 'foo', hasPermission: false, startDateIns: '2026-01-01', endDateIns: '2026-01-31', sortField: 'id', sortDir: 'ASC' })
    expect(rolesFilterModelToSearchParams(model)).toEqual({
      search: 'foo', hasPermission: 'false', startDateIns: '2026-01-01', endDateIns: '2026-01-31',
    })
  })
})
