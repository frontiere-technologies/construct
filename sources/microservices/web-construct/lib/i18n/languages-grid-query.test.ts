import { describe, expect, it } from 'vitest'
import {
  buildLanguagesGridQuery, languagesFilterModelToSearchParams,
  languagesUrlParamsToFilterModel, languagesUrlParamsToSortModel,
  parseLanguagesGridUrlParams,
} from './languages-grid-query'

describe('buildLanguagesGridQuery', () => {
  it('maps every language column filter independently', () => {
    const query = buildLanguagesGridQuery(0, 50, [], {
      code: { filter: 'it' },
      locale: { filter: 'IT' },
      name: { filter: 'Italian' },
      nativeName: { filter: 'Italiano' },
      isActive: { value: 'true' },
      isDefault: { value: 'false' },
      translated: { type: 'inRange', filter: 10, filterTo: 20 },
      missing: { type: 'equals', filter: 2 },
      createdAt: { dateFrom: '2026-07-01 00:00:00', dateTo: '2026-07-30 00:00:00' },
    })

    expect(query).toMatchObject({
      page: 0,
      size: 50,
      codeSearch: 'it',
      localeSearch: 'IT',
      nameSearch: 'Italian',
      nativeNameSearch: 'Italiano',
      isActive: true,
      isDefault: false,
      translatedMin: 10,
      translatedMax: 20,
      missingMin: 2,
      missingMax: 2,
      createdFrom: '2026-07-01',
      createdTo: '2026-07-30',
      sort: 'code',
      direction: 'ASC',
    })
  })

  it('preserves independent compound AND/OR filters', () => {
    const query = buildLanguagesGridQuery(100, 50, [{ colId: 'nativeName', sort: 'desc' }], {
      code: { operator: 'AND', conditions: [{ filter: 'i' }, { filter: 't' }] },
      locale: { operator: 'OR', conditions: [{ filter: 'IT' }, { filter: 'CH' }] },
    })

    expect(query).toMatchObject({
      page: 2,
      codeSearch: { operator: 'AND', conditions: ['i', 't'] },
      localeSearch: { operator: 'OR', conditions: ['IT', 'CH'] },
      sort: 'nativeName',
      direction: 'DESC',
    })
  })

  it('omits invalid enum values instead of coercing them', () => {
    const query = buildLanguagesGridQuery(0, 50, [], {
      isActive: { value: 'yes' },
      isDefault: { value: 1 },
    })

    expect(query.isActive).toBeUndefined()
    expect(query.isDefault).toBeUndefined()
  })
})

describe('languages URL round-trip', () => {
  it('round-trips two text columns and every typed filter together', () => {
    const model = {
      code: { operator: 'AND' as const, conditions: [{ filter: 'i' }, { filter: 't' }] },
      nativeName: { operator: 'OR' as const, conditions: [{ filter: 'Italiano' }, { filter: 'Deutsch' }] },
      isActive: { value: 'false' },
      isDefault: { value: 'true' },
      translated: { type: 'inRange' as const, filter: 10, filterTo: 20 },
      missing: { type: 'equals' as const, filter: 2 },
      createdAt: { dateFrom: '2026-07-01', dateTo: '2026-07-30' },
    }
    const searchParams = languagesFilterModelToSearchParams(model)
    const parsed = parseLanguagesGridUrlParams(Object.fromEntries(
      Object.entries(searchParams).filter((entry): entry is [string, string] => entry[1] !== null),
    ))

    expect(languagesUrlParamsToFilterModel(parsed)).toMatchObject(model)
  })

  it('clears every language filter key for an empty model', () => {
    expect(languagesFilterModelToSearchParams({})).toEqual({
      codeSearch: null, codeSearch2: null, codeSearchOperator: null,
      localeSearch: null, localeSearch2: null, localeSearchOperator: null,
      search: null, search2: null, searchOperator: null,
      nativeNameSearch: null, nativeNameSearch2: null, nativeNameSearchOperator: null,
      isActive: null, isDefault: null,
      translatedMin: null, translatedMax: null,
      missingMin: null, missingMax: null,
      createdFrom: null, createdTo: null,
    })
  })

  it('sanitizes malformed sort, direction, date, number, and boolean URL values', () => {
    const parsed = parseLanguagesGridUrlParams({
      sort: '__proto__', direction: 'UP',
      isActive: '1', isDefault: 'yes',
      translatedMin: 'NaN', translatedMax: 'Infinity',
      missingMin: '-1', missingMax: '1.5',
      createdFrom: 'not-a-date', createdTo: '2026-02-30',
    })

    expect(parsed).toMatchObject({
      sortField: 'code', sortDir: 'ASC',
      isActive: null, isDefault: null,
      translatedMin: null, translatedMax: null,
      missingMin: null, missingMax: null,
      createdFrom: null, createdTo: null,
    })
    expect(languagesUrlParamsToFilterModel(parsed)).toEqual({})
  })

  it('drops inverted numeric and date ranges before building an AG Grid model', () => {
    const parsed = parseLanguagesGridUrlParams({
      translatedMin: '20', translatedMax: '10',
      missingMin: '5', missingMax: '2',
      createdFrom: '2026-07-30', createdTo: '2026-07-01',
    })

    expect(parsed).toMatchObject({
      translatedMin: null, translatedMax: null,
      missingMin: null, missingMax: null,
      createdFrom: null, createdTo: null,
    })
    expect(languagesUrlParamsToFilterModel(parsed)).toEqual({})
  })

  it('drops the unsupported terminal created-to date while preserving a valid lower bound', () => {
    const parsed = parseLanguagesGridUrlParams({
      createdFrom: '9999-12-30', createdTo: '9999-12-31',
    })

    expect(parsed).toMatchObject({ createdFrom: '9999-12-30', createdTo: null })
    expect(languagesUrlParamsToFilterModel(parsed)).toEqual({
      createdAt: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: '9999-12-30' },
    })
  })

  it('accepts only supported sort fields and exact direction values', () => {
    const valid = parseLanguagesGridUrlParams({ sort: 'nativeName', direction: 'DESC' })

    expect(languagesUrlParamsToSortModel(valid)).toEqual([{ colId: 'nativeName', sort: 'desc' }])
  })
})
