import { describe, it, expect } from 'vitest'
import {
  buildRolesGridQuery, parseRolesGridNumberParam, parseRolesGridUrlParams,
  rolesUrlParamsToFilterModel, rolesFilterModelToSearchParams,
} from './roles-grid-query'

describe('buildRolesGridQuery', () => {
  it('defaults to page 0, id/ASC sort, no filters', () => {
    expect(buildRolesGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, search: undefined, hasPermission: undefined,
      idMin: undefined, idMax: undefined,
      associatedUsersMin: undefined, associatedUsersMax: undefined,
      startDateIns: undefined, endDateIns: undefined,
      startDateMod: undefined, endDateMod: undefined,
      sort: 'id', direction: 'ASC',
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

  it('preserves an OR text filter with both conditions', () => {
    expect(buildRolesGridQuery(0, 50, [], {
      description: { operator: 'OR', conditions: [{ filter: 'admin' }, { filter: 'editor' }] },
    }).search).toEqual({ operator: 'OR', conditions: ['admin', 'editor'] })
  })

  it('maps numeric ranges and both dates', () => {
    const q = buildRolesGridQuery(0, 50, [], {
      id: { type: 'inRange', filter: 10, filterTo: 20 },
      associatedUsers: { type: 'equals', filter: 3 },
      dateIns: { dateFrom: '2026-06-01', dateTo: '2026-06-30' },
      dateMod: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    })

    expect(q).toMatchObject({
      idMin: 10, idMax: 20,
      associatedUsersMin: 3, associatedUsersMax: 3,
      startDateIns: '2026-06-01', endDateIns: '2026-06-30',
      startDateMod: '2026-07-01', endDateMod: '2026-07-30',
    })
  })
})

describe('rolesUrlParamsToFilterModel / rolesFilterModelToSearchParams', () => {
  it('normalizes invalid numeric URL values to null', () => {
    expect(parseRolesGridNumberParam('NaN')).toBeNull()
    expect(parseRolesGridNumberParam('Infinity')).toBeNull()
    expect(parseRolesGridNumberParam('10')).toBe(10)
  })

  it('sanitizes malformed sort, direction, and date URL parameters before the initial model is built', () => {
    expect(parseRolesGridUrlParams({
      sort: 'roleName',
      direction: 'UP',
      startDateIns: 'not-a-date',
      endDateIns: '2026-02-30',
      startDateMod: '2026-07-01',
      endDateMod: '2026-13-01',
    })).toMatchObject({
      sortField: 'id',
      sortDir: 'ASC',
      startDateIns: null,
      endDateIns: null,
      startDateMod: '2026-07-01',
      endDateMod: null,
    })
  })

  it('drops an unsupported upper bound while preserving the lower date in both role columns', () => {
    const params = parseRolesGridUrlParams({
      startDateIns: '9999-12-30', endDateIns: '9999-12-31',
      startDateMod: '9999-12-30', endDateMod: '9999-12-31',
    })

    expect(params).toMatchObject({
      startDateIns: '9999-12-30', endDateIns: null,
      startDateMod: '9999-12-30', endDateMod: null,
    })
    expect(rolesUrlParamsToFilterModel(params)).toMatchObject({
      dateIns: { type: 'greaterThanOrEqual', dateFrom: '9999-12-30' },
      dateMod: { type: 'greaterThanOrEqual', dateFrom: '9999-12-30' },
    })
  })

  it.each([
    ['ID', { idMin: '20', idMax: '10' }, ['idMin', 'idMax']],
    ['associated users', { associatedUsersMin: '4', associatedUsersMax: '3' }, ['associatedUsersMin', 'associatedUsersMax']],
    ['created date', { startDateIns: '2026-07-31', endDateIns: '2026-07-01' }, ['startDateIns', 'endDateIns']],
    ['updated date', { startDateMod: '2026-07-31', endDateMod: '2026-07-01' }, ['startDateMod', 'endDateMod']],
  ] as const)('drops an inverted %s URL range before it reaches the query', (_label, raw, fields) => {
    const parsed = parseRolesGridUrlParams(raw)
    const model = rolesUrlParamsToFilterModel(parsed)
    const query = buildRolesGridQuery(0, 50, [], model)

    expect(parsed[fields[0]]).toBeNull()
    expect(parsed[fields[1]]).toBeNull()
    expect(query[fields[0]]).toBeUndefined()
    expect(query[fields[1]]).toBeUndefined()
  })

  it('drops inverted ranges received directly from AG Grid while preserving valid one-sided ranges', () => {
    const inverted = buildRolesGridQuery(0, 50, [], {
      id: { type: 'inRange', filter: 20, filterTo: 10 },
      associatedUsers: { type: 'inRange', filter: 4, filterTo: 3 },
      dateIns: { type: 'inRange', dateFrom: '2026-07-31', dateTo: '2026-07-01' },
      dateMod: { type: 'inRange', dateFrom: '2026-07-31', dateTo: '2026-07-01' },
    })
    const oneSided = buildRolesGridQuery(0, 50, [], {
      dateIns: { type: 'greaterThanOrEqual', dateFrom: '2026-07-01' },
      dateMod: { type: 'lessThanOrEqual', dateFrom: '2026-07-30' },
    })

    expect(inverted).toMatchObject({
      idMin: undefined, idMax: undefined,
      associatedUsersMin: undefined, associatedUsersMax: undefined,
      startDateIns: undefined, endDateIns: undefined,
      startDateMod: undefined, endDateMod: undefined,
    })
    expect(oneSided).toMatchObject({
      startDateIns: '2026-07-01', endDateIns: undefined,
      startDateMod: undefined, endDateMod: '2026-07-30',
    })
  })

  it.each([
    ['created', 'startDateIns', 'endDateIns'],
    ['updated', 'startDateMod', 'endDateMod'],
  ] as const)('carries the %s URL through the model and query while dropping a terminal upper', (_label, lowerField, upperField) => {
    const params = parseRolesGridUrlParams({
      [lowerField]: '9999-12-31',
      [upperField]: '9999-12-31',
    })
    const query = buildRolesGridQuery(0, 50, [], rolesUrlParamsToFilterModel(params))

    expect(query[lowerField]).toBe('9999-12-31')
    expect(query[upperField]).toBeUndefined()
  })

  it.each([
    ['created', 'startDateIns', 'endDateIns'],
    ['updated', 'startDateMod', 'endDateMod'],
  ] as const)('carries a valid one-sided %s upper URL below the maximum through the model and query', (_label, lowerField, upperField) => {
    const params = parseRolesGridUrlParams({ [upperField]: '9999-12-30' })
    const query = buildRolesGridQuery(0, 50, [], rolesUrlParamsToFilterModel(params))

    expect(query[lowerField]).toBeUndefined()
    expect(query[upperField]).toBe('9999-12-30')
  })

  it('produces an empty model when nothing is set', () => {
    expect(rolesUrlParamsToFilterModel({ search: '', hasPermission: null, startDateIns: null, endDateIns: null, sortField: 'id', sortDir: 'ASC' })).toEqual({})
  })

  it('round-trips filter values through both directions', () => {
    const model = rolesUrlParamsToFilterModel({ search: 'foo', hasPermission: false, startDateIns: '2026-01-01', endDateIns: '2026-01-31', sortField: 'id', sortDir: 'ASC' })
    expect(rolesFilterModelToSearchParams(model)).toEqual({
      search: 'foo', search2: null, searchOperator: null,
      idMin: null, idMax: null,
      associatedUsersMin: null, associatedUsersMax: null,
      hasPermission: 'false', startDateIns: '2026-01-01', endDateIns: '2026-01-31',
      startDateMod: null, endDateMod: null,
    })
  })

  it('restores a one-sided created date as a greater-than-or-equal grid model', () => {
    expect(rolesUrlParamsToFilterModel({
      search: '', hasPermission: null, startDateIns: '2026-07-01', endDateIns: null,
      sortField: 'id', sortDir: 'ASC',
    })).toMatchObject({
      dateIns: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: '2026-07-01' },
    })
  })

  it('serialises both AND conditions for URL navigation', () => {
    expect(rolesFilterModelToSearchParams({
      description: { operator: 'AND', conditions: [{ filter: 'admin' }, { filter: 'service' }] },
    })).toMatchObject({ search: 'admin', search2: 'service', searchOperator: 'AND' })
  })

  it('round-trips numeric ranges and the updated-date range', () => {
    const model = rolesUrlParamsToFilterModel({
      search: '', hasPermission: null,
      idMin: 10, idMax: 20,
      associatedUsersMin: 3, associatedUsersMax: 3,
      startDateIns: null, endDateIns: null,
      startDateMod: '2026-07-01', endDateMod: '2026-07-30',
      sortField: 'id', sortDir: 'ASC',
    })

    expect(model).toMatchObject({
      id: { type: 'inRange', filter: 10, filterTo: 20 },
      associatedUsers: { type: 'equals', filter: 3 },
      dateMod: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    })
    expect(rolesFilterModelToSearchParams(model)).toMatchObject({
      idMin: '10', idMax: '20',
      associatedUsersMin: '3', associatedUsersMax: '3',
      startDateMod: '2026-07-01', endDateMod: '2026-07-30',
    })
  })

  it('clears every filter URL key for an empty model', () => {
    expect(rolesFilterModelToSearchParams({})).toEqual({
      search: null, search2: null, searchOperator: null,
      idMin: null, idMax: null,
      associatedUsersMin: null, associatedUsersMax: null,
      hasPermission: null,
      startDateIns: null, endDateIns: null,
      startDateMod: null, endDateMod: null,
    })
  })
})
