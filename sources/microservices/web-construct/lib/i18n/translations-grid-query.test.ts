import { describe, it, expect } from 'vitest'
import {
  buildTranslationsGridQuery, translationsFilterModelToSearchParams,
  parseTranslationsGridUrlParams, translationsUrlParamsToFilterModel, translationsUrlParamsToSortModel,
} from './translations-grid-query'

describe('buildTranslationsGridQuery', () => {
  it('derives the page number from the start row', () => {
    expect(buildTranslationsGridQuery(150, 50, [], {}).page).toBe(3)
  })
  it('maps the key text filter to `search`', () => {
    expect(buildTranslationsGridQuery(0, 50, [], { key: { filter: 'common.' } }).search).toBe('common.')
  })
  it('preserves an OR text filter with both conditions', () => {
    expect(buildTranslationsGridQuery(0, 50, [], {
      key: { operator: 'OR', conditions: [{ filter: 'common.' }, { filter: 'users.' }] },
    }).search).toEqual({ operator: 'OR', conditions: ['common.', 'users.'] })
  })
  it('maps description and language filters to independent searches', () => {
    const q = buildTranslationsGridQuery(0, 50, [], {
      description: { filter: 'button label' },
      value_en: { operator: 'OR', conditions: [{ filter: 'save' }, { filter: 'store' }] },
      value_it: { filter: 'salva' },
    })

    expect(q.descriptionSearch).toBe('button label')
    expect(q.valueSearches).toEqual({
      en: { operator: 'OR', conditions: ['save', 'store'] },
      it: 'salva',
    })
  })
  it('maps namespace, module, language and status filters', () => {
    const q = buildTranslationsGridQuery(0, 50, [], {
      namespace: { value: 'auth' }, module: { value: 'core' },
      language: { value: 'en' }, status: { value: 'missing' },
    })
    expect(q).toMatchObject({ namespace: 'auth', module: 'core', languageCode: 'en', status: 'missing' })
  })
  it('maps the updated date range', () => {
    expect(buildTranslationsGridQuery(0, 50, [], {
      updatedAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    })).toMatchObject({ updatedFrom: '2026-07-01', updatedTo: '2026-07-30' })
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
    })).toEqual({
      search: 'auth', search2: null, searchOperator: null,
      description: null, description2: null, descriptionOperator: null,
      namespace: 'auth', module: 'core', language: 'en', status: 'missing',
      updatedFrom: null, updatedTo: null,
    })
  })
  it('round-trips the updated date range through URL params', () => {
    const params = translationsFilterModelToSearchParams({
      updatedAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    })

    expect(params).toMatchObject({ updatedFrom: '2026-07-01', updatedTo: '2026-07-30' })
    expect(translationsUrlParamsToFilterModel(params)).toMatchObject({
      updatedAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    })
  })
  it('nulls out absent filters', () => {
    expect(translationsFilterModelToSearchParams({}))
      .toEqual({
        search: null, search2: null, searchOperator: null,
        description: null, description2: null, descriptionOperator: null,
        namespace: null, module: null, language: null, status: null,
        updatedFrom: null, updatedTo: null,
      })
  })
  it('serialises both AND conditions for URL navigation', () => {
    expect(translationsFilterModelToSearchParams({
      key: { operator: 'AND', conditions: [{ filter: 'common.' }, { filter: 'actions' }] },
    })).toMatchObject({ search: 'common.', search2: 'actions', searchOperator: 'AND' })
  })
  it('round-trips description and dynamic language filters through URL params', () => {
    const params = translationsFilterModelToSearchParams({
      description: { filter: 'label' },
      value_en: { operator: 'AND', conditions: [{ filter: 'save' }, { filter: 'now' }] },
    })

    expect(params).toMatchObject({
      description: 'label', description2: null, descriptionOperator: null,
      value_en: 'save', value_en2: 'now', value_enOperator: 'AND',
    })
    expect(translationsUrlParamsToFilterModel(params)).toMatchObject({
      description: { filter: 'label' },
      value_en: {
        filterType: 'text', operator: 'AND',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'save' },
          { filterType: 'text', type: 'contains', filter: 'now' },
        ],
      },
    })
  })
  it('clears removed dynamic language filters while preserving active ones', () => {
    expect(translationsFilterModelToSearchParams({
      value_it: { filter: 'salva' },
    }, ['en', 'it'])).toMatchObject({
      value_en: null, value_en2: null, value_enOperator: null,
      value_it: 'salva', value_it2: null, value_itOperator: null,
    })
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

  it('sanitizes invalid URL filters before they become an AG Grid model', () => {
    const params = parseTranslationsGridUrlParams({
      updatedFrom: '2026-07-31', updatedTo: '2026-07-01', status: 'partial',
      sort: '__proto__', direction: 'UP', value_en: 'save', value_en2: 'now', value_enOperator: 'XOR',
    })

    expect(params).toMatchObject({
      updatedFrom: null, updatedTo: null, status: null, sortField: 'key', sortDir: 'ASC',
      value_en: 'save', value_en2: 'now', value_enOperator: null,
    })
    expect(translationsUrlParamsToFilterModel(params)).toEqual({
      value_en: {
        filterType: 'text', operator: 'AND',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'save' },
          { filterType: 'text', type: 'contains', filter: 'now' },
        ],
      },
    })
  })

  it('keeps a valid upper updated-date bound from the URL', () => {
    const params = parseTranslationsGridUrlParams({ updatedTo: '2026-07-30' })

    expect(translationsUrlParamsToFilterModel(params)).toEqual({
      updatedAt: { dateFrom: undefined, dateTo: '2026-07-30' },
    })
  })
})
