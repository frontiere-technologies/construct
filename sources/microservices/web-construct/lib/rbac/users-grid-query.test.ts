import { describe, it, expect } from 'vitest'
import { buildUsersGridQuery, usersUrlParamsToFilterModel, usersFilterModelToSearchParams } from './users-grid-query'

describe('buildUsersGridQuery', () => {
  it('defaults to page 0, dateIns/DESC sort, no filters', () => {
    expect(buildUsersGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, search: undefined, roleIds: undefined, statuses: undefined,
      createdFrom: undefined, createdTo: undefined, sort: 'dateIns', direction: 'DESC',
    })
  })

  it('computes page from startRow and block size', () => {
    expect(buildUsersGridQuery(150, 50, [], {}).page).toBe(3)
  })

  it('maps text, enum, and date-range filters plus an explicit sort', () => {
    const q = buildUsersGridQuery(0, 50, [{ colId: 'email', sort: 'asc' }], {
      firstName: { filter: 'mario' },
      roles: { value: 1 },
      status: { value: 2 },
      dateIns: { dateFrom: '2026-01-01 00:00:00', dateTo: '2026-01-31 00:00:00' },
    })
    expect(q.search).toBe('mario')
    expect(q.roleIds).toEqual([1])
    expect(q.statuses).toEqual([2])
    expect(q.createdFrom).toBe('2026-01-01')
    expect(q.createdTo).toBe('2026-01-31')
    expect(q.sort).toBe('email')
    expect(q.direction).toBe('ASC')
  })
})

describe('usersUrlParamsToFilterModel / usersFilterModelToSearchParams', () => {
  it('produces an empty model when nothing is set', () => {
    expect(usersUrlParamsToFilterModel({ search: '', roleId: null, statusId: null, createdFrom: null, createdTo: null, sortField: 'dateIns', sortDir: 'DESC' })).toEqual({})
  })

  it('round-trips filter values through both directions', () => {
    const model = usersUrlParamsToFilterModel({ search: 'foo', roleId: 1, statusId: 2, createdFrom: '2026-01-01', createdTo: '2026-01-31', sortField: 'dateIns', sortDir: 'DESC' })
    expect(usersFilterModelToSearchParams(model)).toEqual({
      search: 'foo', roleIds: '1', statuses: '2', createdFrom: '2026-01-01', createdTo: '2026-01-31',
    })
  })
})
