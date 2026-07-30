import { describe, it, expect } from 'vitest'
import {
  buildUsersGridQuery, parseUsersGridIntegerParam,
  usersUrlParamsToFilterModel, usersFilterModelToSearchParams,
} from './users-grid-query'

describe('buildUsersGridQuery', () => {
  it('defaults to page 0, dateIns/DESC sort, no filters', () => {
    expect(buildUsersGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, nameSearch: undefined, emailSearch: undefined, roleIds: undefined, statuses: undefined,
      createdFrom: undefined, createdTo: undefined, updatedFrom: undefined, updatedTo: undefined,
      sort: 'dateIns', direction: 'DESC',
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
    expect(q.nameSearch).toBe('mario')
    expect(q.roleIds).toEqual([1])
    expect(q.statuses).toEqual([2])
    expect(q.createdFrom).toBe('2026-01-01')
    expect(q.createdTo).toBe('2026-01-31')
    expect(q.sort).toBe('email')
    expect(q.direction).toBe('ASC')
  })

  it('preserves an AND text filter with both conditions', () => {
    const q = buildUsersGridQuery(0, 50, [], {
      firstName: {
        operator: 'AND',
        conditions: [{ filter: 'mario' }, { filter: 'frontiere' }],
      },
    })

    expect(q.nameSearch).toEqual({ operator: 'AND', conditions: ['mario', 'frontiere'] })
  })

  it('maps name, email and both date columns independently', () => {
    const q = buildUsersGridQuery(0, 50, [], {
      firstName: { filter: 'Mario' },
      email: { filter: '@frontiere.it' },
      dateIns: { dateFrom: '2026-07-01', dateTo: '2026-07-15' },
      dateMod: { dateFrom: '2026-07-16', dateTo: '2026-07-30' },
    })

    expect(q).toMatchObject({
      nameSearch: 'Mario', emailSearch: '@frontiere.it',
      createdFrom: '2026-07-01', createdTo: '2026-07-15',
      updatedFrom: '2026-07-16', updatedTo: '2026-07-30',
    })
  })
})

describe('usersUrlParamsToFilterModel / usersFilterModelToSearchParams', () => {
  it('produces an empty model when nothing is set', () => {
    expect(usersUrlParamsToFilterModel({ search: '', roleId: null, statusId: null, createdFrom: null, createdTo: null, sortField: 'dateIns', sortDir: 'DESC' })).toEqual({})
  })

  it('omits an invalid role id from URL parameters instead of creating a NaN filter', () => {
    const roleId = parseUsersGridIntegerParam('NaN')
    const model = usersUrlParamsToFilterModel({ search: '', roleId, statusId: null, createdFrom: null, createdTo: null, sortField: 'dateIns', sortDir: 'DESC' })

    expect(roleId).toBeNull()
    expect(model.roles).toBeUndefined()
  })

  it('round-trips filter values through both directions', () => {
    const model = usersUrlParamsToFilterModel({ search: 'foo', roleId: 1, statusId: 2, createdFrom: '2026-01-01', createdTo: '2026-01-31', sortField: 'dateIns', sortDir: 'DESC' })
    expect(usersFilterModelToSearchParams(model)).toEqual({
      search: 'foo', search2: null, searchOperator: null,
      emailSearch: null, emailSearch2: null, emailSearchOperator: null,
      roleIds: '1', statuses: '2', createdFrom: '2026-01-01', createdTo: '2026-01-31',
      updatedFrom: null, updatedTo: null,
    })
  })

  it('serialises both OR conditions so navigation does not discard the compound filter', () => {
    expect(usersFilterModelToSearchParams({
      firstName: {
        operator: 'OR',
        conditions: [{ filter: 'mario' }, { filter: 'luigi' }],
      },
    })).toMatchObject({ search: 'mario', search2: 'luigi', searchOperator: 'OR' })
  })

  it('restores both AND conditions after navigation', () => {
    expect(usersUrlParamsToFilterModel({
      search: 'mario', search2: 'frontiere', searchOperator: 'AND',
      roleId: null, statusId: null, createdFrom: null, createdTo: null,
      sortField: 'dateIns', sortDir: 'DESC',
    })).toEqual({
      firstName: {
        filterType: 'text', operator: 'AND',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'mario' },
          { filterType: 'text', type: 'contains', filter: 'frontiere' },
        ],
      },
    })
  })

  it('round-trips compound email conditions through URL params', () => {
    const model = usersUrlParamsToFilterModel({
      search: '', emailSearch: 'frontiere.it', emailSearch2: 'example.com', emailSearchOperator: 'OR',
      roleId: null, statusId: null, createdFrom: null, createdTo: null, updatedFrom: null, updatedTo: null,
      sortField: 'dateIns', sortDir: 'DESC',
    })

    expect(usersFilterModelToSearchParams(model)).toMatchObject({
      emailSearch: 'frontiere.it', emailSearch2: 'example.com', emailSearchOperator: 'OR',
    })
  })

  it('serializes every user filter key as null when the model is empty', () => {
    expect(usersFilterModelToSearchParams({})).toEqual({
      search: null, search2: null, searchOperator: null,
      emailSearch: null, emailSearch2: null, emailSearchOperator: null,
      roleIds: null, statuses: null,
      createdFrom: null, createdTo: null, updatedFrom: null, updatedTo: null,
    })
  })
})
