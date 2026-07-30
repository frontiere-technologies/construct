import type { TranslationsQuery, TranslationStatusFilter } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearch, type TextSearchOperator,
} from '@/lib/grid-text-search'

export interface TranslationsGridFilterModel {
  key?: GridTextFilterModel
  description?: GridTextFilterModel
  [colId: `value_${string}`]: GridTextFilterModel | undefined
  namespace?: { value?: string | number }
  module?: { value?: string | number }
  language?: { value?: string | number }
  status?: { value?: string | number }
}

export interface TranslationsGridSortItem { colId: string; sort: 'asc' | 'desc' }

const asString = (v: string | number | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : String(v)

function addTextSearchParams(
  result: Record<string, string | null>,
  prefix: string,
  model: GridTextFilterModel | undefined,
) {
  const value = gridTextFilterToSearchParams(model)
  result[prefix] = value.search
  result[`${prefix}2`] = value.search2
  result[`${prefix}Operator`] = value.searchOperator
}

export function buildTranslationsGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: TranslationsGridSortItem[],
  filterModel: TranslationsGridFilterModel,
): TranslationsQuery {
  const sortItem = sortModel[0]
  const status = asString(filterModel.status?.value)
  const valueSearches: Record<string, TextSearch> = {}
  for (const colId of Object.keys(filterModel)) {
    if (!colId.startsWith('value_')) continue
    const search = gridTextFilterToSearch(filterModel[colId as `value_${string}`])
    if (search) valueSearches[colId.slice('value_'.length)] = search
  }
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: gridTextFilterToSearch(filterModel.key),
    descriptionSearch: gridTextFilterToSearch(filterModel.description),
    valueSearches: Object.keys(valueSearches).length ? valueSearches : undefined,
    namespace: asString(filterModel.namespace?.value),
    module: asString(filterModel.module?.value),
    languageCode: asString(filterModel.language?.value),
    status: status && status !== 'all' ? (status as TranslationStatusFilter) : undefined,
    sort: (sortItem?.colId as TranslationsQuery['sort']) ?? 'key',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface TranslationsUrlParams {
  search?: string | null
  search2?: string
  searchOperator?: TextSearchOperator | null
  description?: string | null
  description2?: string
  descriptionOperator?: TextSearchOperator | null
  namespace?: string | null
  module?: string | null
  language?: string | null
  status?: string | null
  sortField?: string
  sortDir?: 'ASC' | 'DESC'
}

export function translationsUrlParamsToFilterModel<T extends TranslationsUrlParams>(p: T): TranslationsGridFilterModel {
  const urlParams = p as unknown as Record<string, string | null | undefined>
  const model: TranslationsGridFilterModel = {}
  const textFilter = searchParamsToGridTextFilter(p.search ?? '', p.search2 ?? undefined, p.searchOperator)
  if (textFilter) model.key = textFilter
  const descriptionFilter = searchParamsToGridTextFilter(urlParams.description ?? '', urlParams.description2 ?? undefined, urlParams.descriptionOperator as TextSearchOperator | null | undefined)
  if (descriptionFilter) model.description = descriptionFilter
  for (const param of Object.keys(urlParams)) {
    if (!param.startsWith('value_') || param.endsWith('2') || param.endsWith('Operator')) continue
    const filter = searchParamsToGridTextFilter(urlParams[param] ?? '', urlParams[`${param}2`] ?? undefined, urlParams[`${param}Operator`] as TextSearchOperator | null | undefined)
    if (filter) model[param as `value_${string}`] = filter
  }
  if (p.namespace) model.namespace = { value: p.namespace }
  if (p.module) model.module = { value: p.module }
  if (p.language) model.language = { value: p.language }
  if (p.status) model.status = { value: p.status }
  return model
}

export function translationsUrlParamsToSortModel<T extends TranslationsUrlParams>(p: T): TranslationsGridSortItem[] {
  return [{ colId: p.sortField ?? 'key', sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function translationsFilterModelToSearchParams(
  model: TranslationsGridFilterModel,
  activeLanguageCodes: readonly string[] = [],
): Record<string, string | null> {
  const result = {
    ...gridTextFilterToSearchParams(model.key),
    namespace: asString(model.namespace?.value) ?? null,
    module: asString(model.module?.value) ?? null,
    language: asString(model.language?.value) ?? null,
    status: asString(model.status?.value) ?? null,
  }
  addTextSearchParams(result, 'description', model.description)
  for (const code of activeLanguageCodes) addTextSearchParams(result, `value_${code}`, undefined)
  for (const colId of Object.keys(model)) {
    if (colId.startsWith('value_')) addTextSearchParams(result, colId, model[colId as `value_${string}`])
  }
  return result
}
