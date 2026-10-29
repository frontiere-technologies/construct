import { describe, expect, it } from 'vitest'
import {
  buildTenantsGridQuery, parseTenantsGridUrlParams, tenantsFilterModelToSearchParams,
  tenantsUrlParamsToFilterModel, tenantsUrlParamsToSortModel,
} from './tenants-grid-query'
import { TENANTS_GRID_MAX_PAGE_SIZE, tenantsGridQuerySchema } from './tenants-grid-query-schema'

/**
 * La griglia dei tenant della console (specifica 2026-10-26, MT5-DEC-4): dal modello dei filtri di
 * ag-grid alla richiesta, dalla richiesta all'indirizzo della pagina e ritorno.
 */
describe('buildTenantsGridQuery', () => {
  it('maps every column filter and the page', () => {
    const query = buildTenantsGridQuery(100, 50, [{ colId: 'slug', sort: 'desc' }], {
      name: { filter: 'Acme' },
      slug: { operator: 'OR', conditions: [{ filter: 'a' }, { filter: 'b' }] },
      host: { filter: 'acme.example' },
      status: { value: 'archived' },
      createdAt: { dateFrom: '2026-07-01 00:00:00', dateTo: '2026-07-30 00:00:00' },
    })
    expect(query).toEqual({
      page: 2,
      size: 50,
      nameSearch: 'Acme',
      slugSearch: { operator: 'OR', conditions: ['a', 'b'] },
      hostSearch: 'acme.example',
      status: 'archived',
      createdFrom: '2026-07-01',
      createdTo: '2026-07-30',
      sort: 'slug',
      direction: 'DESC',
    })
  })

  it('sorts by name ascending by default and leaves out filters that were not set', () => {
    const query = buildTenantsGridQuery(0, 50, [], {})
    expect(query).toMatchObject({ page: 0, size: 50, sort: 'name', direction: 'ASC' })
    expect(query.status).toBeUndefined()
    expect(query.nameSearch).toBeUndefined()
  })

  it('drops a status that is not one of the three', () => {
    expect(buildTenantsGridQuery(0, 50, [], { status: { value: 'deleted' } }).status).toBeUndefined()
  })
})

describe('the page address', () => {
  it('round-trips the filters through the URL', () => {
    const model = {
      name: { filter: 'Acme' },
      status: { value: 'suspended' },
      createdAt: { filterType: 'date' as const, type: 'inRange' as const, dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    }
    const params = tenantsFilterModelToSearchParams(model)
    expect(params).toMatchObject({ search: 'Acme', status: 'suspended', createdFrom: '2026-07-01', createdTo: '2026-07-30' })
    const parsed = parseTenantsGridUrlParams(Object.fromEntries(
      Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== null)))
    expect(tenantsUrlParamsToFilterModel(parsed)).toEqual(model)
  })

  it('clears every filter when the model is empty', () => {
    expect(Object.values(tenantsFilterModelToSearchParams({})).every(value => value === null)).toBe(true)
  })

  it('ignores a malformed status, an impossible date and an unknown sort column', () => {
    const parsed = parseTenantsGridUrlParams({ status: 'nope', createdFrom: '2026-02-30', sort: 'activeMembers', direction: 'DESC' })
    expect(parsed).toMatchObject({ status: null, createdFrom: null, sortField: 'name', sortDir: 'DESC' })
    expect(tenantsUrlParamsToSortModel(parsed)).toEqual([{ colId: 'name', sort: 'desc' }])
  })
})

describe('tenantsGridQuerySchema', () => {
  it('accepts a complete query and a bare page', () => {
    expect(tenantsGridQuerySchema.safeParse({ page: 0, size: 50 }).success).toBe(true)
    expect(tenantsGridQuerySchema.safeParse({
      page: 1, size: 20, nameSearch: 'a', slugSearch: { operator: 'AND', conditions: ['a', 'b'] }, hostSearch: 'h',
      status: 'active', createdFrom: '2026-07-01', createdTo: '2026-07-30', sort: 'createdAt', direction: 'DESC',
    }).success).toBe(true)
  })

  it.each([
    ['a size above the limit', { size: TENANTS_GRID_MAX_PAGE_SIZE + 1 }],
    ['a negative page', { page: -1 }],
    ['an unknown status', { status: 'deleted' }],
    ['a malformed date', { createdTo: '2026-02-30' }],
    ['an inverted period', { createdFrom: '2026-07-30', createdTo: '2026-07-01' }],
    ['a sort on a column the list cannot sort by', { sort: 'activeMembers' }],
    ['an empty search', { nameSearch: '' }],
  ])('refuses %s', (_label, invalid) => {
    expect(tenantsGridQuerySchema.safeParse({ page: 0, size: 50, ...invalid }).success).toBe(false)
  })
})
