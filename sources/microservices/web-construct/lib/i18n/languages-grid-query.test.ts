import { describe, it, expect } from 'vitest'
import {
  buildLanguagesGridQuery, languagesFilterModelToSearchParams,
  languagesUrlParamsToFilterModel, languagesUrlParamsToSortModel,
} from './languages-grid-query'

describe('buildLanguagesGridQuery', () => {
  it('derives the page number from the start row', () => {
    expect(buildLanguagesGridQuery(100, 50, [], {}).page).toBe(2)
  })
  it('maps the name text filter to `search`', () => {
    expect(buildLanguagesGridQuery(0, 50, [], { name: { filter: 'ital' } }).search).toBe('ital')
  })
  it('maps the isActive enum filter to a boolean', () => {
    expect(buildLanguagesGridQuery(0, 50, [], { isActive: { value: 'true' } }).isActive).toBe(true)
    expect(buildLanguagesGridQuery(0, 50, [], { isActive: { value: 'false' } }).isActive).toBe(false)
    expect(buildLanguagesGridQuery(0, 50, [], {}).isActive).toBeUndefined()
  })
  it('maps the sort model, defaulting to code ascending', () => {
    expect(buildLanguagesGridQuery(0, 50, [], {})).toMatchObject({ sort: 'code', direction: 'ASC' })
    expect(buildLanguagesGridQuery(0, 50, [{ colId: 'name', sort: 'desc' }], {}))
      .toMatchObject({ sort: 'name', direction: 'DESC' })
  })
})

describe('languages URL round-trip', () => {
  it('turns a filter model into search params and back', () => {
    const model = { name: { filter: 'en' }, isActive: { value: 'false' } }
    const params = languagesFilterModelToSearchParams(model)
    expect(params).toEqual({ search: 'en', isActive: 'false' })
    expect(languagesUrlParamsToFilterModel({
      search: 'en', isActive: false, sortField: 'code', sortDir: 'ASC',
    })).toEqual(model)
  })
  it('nulls out absent filters so the URL stays clean', () => {
    expect(languagesFilterModelToSearchParams({})).toEqual({ search: null, isActive: null })
  })
  it('builds the sort model from URL params', () => {
    expect(languagesUrlParamsToSortModel({ search: '', isActive: null, sortField: 'name', sortDir: 'DESC' }))
      .toEqual([{ colId: 'name', sort: 'desc' }])
  })
})
