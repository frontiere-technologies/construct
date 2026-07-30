import { describe, it, expect } from 'vitest'
import {
  buildTranslationsGridQuery, translationsFilterModelToSearchParams,
  translationsUrlParamsToFilterModel, translationsUrlParamsToSortModel,
} from './translations-grid-query'

describe('buildTranslationsGridQuery', () => {
  it('derives the page number from the start row', () => {
    expect(buildTranslationsGridQuery(150, 50, [], {}).page).toBe(3)
  })
  it('maps the key text filter to `search`', () => {
    expect(buildTranslationsGridQuery(0, 50, [], { key: { filter: 'common.' } }).search).toBe('common.')
  })
  it('maps namespace, module, language and status filters', () => {
    const q = buildTranslationsGridQuery(0, 50, [], {
      namespace: { value: 'auth' }, module: { value: 'core' },
      language: { value: 'en' }, status: { value: 'missing' },
    })
    expect(q).toMatchObject({ namespace: 'auth', module: 'core', languageCode: 'en', status: 'missing' })
  })
  it('omits the status filter when it is "all"', () => {
    expect(buildTranslationsGridQuery(0, 50, [], { status: { value: 'all' } }).status).toBeUndefined()
  })
  it('defaults to sorting by key ascending', () => {
    expect(buildTranslationsGridQuery(0, 50, [], {})).toMatchObject({ sort: 'key', direction: 'ASC' })
  })
  it('honours an explicit sort model', () => {
    expect(buildTranslationsGridQuery(0, 50, [{ colId: 'updatedAt', sort: 'desc' }], {}))
      .toMatchObject({ sort: 'updatedAt', direction: 'DESC' })
  })
})

describe('translations URL round-trip', () => {
  it('serialises every filter to search params', () => {
    expect(translationsFilterModelToSearchParams({
      key: { filter: 'auth' }, namespace: { value: 'auth' },
      module: { value: 'core' }, language: { value: 'en' }, status: { value: 'missing' },
    })).toEqual({ search: 'auth', namespace: 'auth', module: 'core', language: 'en', status: 'missing' })
  })
  it('nulls out absent filters', () => {
    expect(translationsFilterModelToSearchParams({}))
      .toEqual({ search: null, namespace: null, module: null, language: null, status: null })
  })
  it('rebuilds the filter model from URL params', () => {
    expect(translationsUrlParamsToFilterModel({
      search: 'auth', namespace: 'auth', module: null, language: 'en', status: 'missing',
      sortField: 'key', sortDir: 'ASC',
    })).toEqual({
      key: { filter: 'auth' }, namespace: { value: 'auth' },
      language: { value: 'en' }, status: { value: 'missing' },
    })
  })
  it('builds the sort model from URL params', () => {
    expect(translationsUrlParamsToSortModel({
      search: '', namespace: null, module: null, language: null, status: null,
      sortField: 'updatedAt', sortDir: 'DESC',
    })).toEqual([{ colId: 'updatedAt', sort: 'desc' }])
  })
})
