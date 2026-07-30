import type { TranslationsQuery, TranslationStatusFilter } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearch, type TextSearchOperator,
} from '@/lib/grid-text-search'
import { dateRangeToGridFilter, gridDateFilterToRange, type GridDateFilterModel } from '@/lib/grid-filter-models'
import { isSupportedTranslationUpdatedTo } from './translation-grid-boundaries'

export interface TranslationsGridFilterModel {
  key?: GridTextFilterModel
  description?: GridTextFilterModel
  [colId: `value_${string}`]: GridTextFilterModel | undefined
  namespace?: { value?: string | number }
  module?: { value?: string | number }
  language?: { value?: string | number }
  status?: { value?: string | number }
  updatedAt?: GridDateFilterModel
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
  const updatedRange = gridDateFilterToRange(filterModel.updatedAt)
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
    updatedFrom: updatedRange?.from,
    updatedTo: updatedRange?.to,
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
  updatedFrom?: string | null
  updatedTo?: string | null
  sortField?: string
  sortDir?: 'ASC' | 'DESC'
  [param: `value_${string}`]: string | null | undefined
}

const TRANSLATION_SORT_FIELDS = new Set<NonNullable<TranslationsQuery['sort']>>([
  'key', 'namespace', 'module', 'updatedAt',
])

function parseDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null
}

function orderedDateRange(from: string | null, to: string | null): [string | null, string | null] {
  return !from || !to || from > to ? [null, null] : [from, to]
}

/** Converts untrusted URL values into the subset AG Grid can safely render. */
export function parseTranslationsGridUrlParams(
  params: Record<string, string | undefined>,
  activeLanguageCodes: readonly string[] = [],
): TranslationsUrlParams {
  const activeCodes = new Set(activeLanguageCodes)
  const parsedTo = parseDate(params.updatedTo)
  const [updatedFrom, updatedTo] = orderedDateRange(
    parseDate(params.updatedFrom),
    parsedTo && isSupportedTranslationUpdatedTo(parsedTo) ? parsedTo : null,
  )
  const result: TranslationsUrlParams = {
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: params.searchOperator === 'AND' || params.searchOperator === 'OR' ? params.searchOperator : null,
    description: params.description ?? '',
    description2: params.description2 ?? '',
    descriptionOperator: params.descriptionOperator === 'AND' || params.descriptionOperator === 'OR'
      ? params.descriptionOperator
      : null,
    namespace: params.namespace || null,
    module: params.module || null,
    language: /^[a-z]{2,3}$/.test(params.language ?? '') ? params.language! : null,
    status: params.status === 'all' || params.status === 'missing' || params.status === 'complete' ? params.status : null,
    updatedFrom,
    updatedTo,
    sortField: params.sort && TRANSLATION_SORT_FIELDS.has(params.sort as NonNullable<TranslationsQuery['sort']>)
      ? params.sort
      : 'key',
    sortDir: params.direction === 'DESC' ? 'DESC' : 'ASC',
  }
  const dynamicParams = result as Record<string, string | null | undefined>
  for (const key of Object.keys(params)) {
    const code = key.startsWith('value_') ? key.slice('value_'.length) : ''
    if (!/^value_[a-z]{2,3}$/.test(key) || !activeCodes.has(code) || !params[key]) continue
    dynamicParams[key] = params[key]
    dynamicParams[`${key}2`] = params[`${key}2`] ?? ''
    dynamicParams[`${key}Operator`] = params[`${key}Operator`] === 'AND' || params[`${key}Operator`] === 'OR'
      ? params[`${key}Operator`]!
      : null
  }
  return result
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
  const parsedTo = parseDate(p.updatedTo ?? undefined)
  const [updatedFrom, updatedTo] = orderedDateRange(
    parseDate(p.updatedFrom ?? undefined),
    parsedTo && isSupportedTranslationUpdatedTo(parsedTo) ? parsedTo : null,
  )
  const updatedFilter = dateRangeToGridFilter({ from: updatedFrom ?? undefined, to: updatedTo ?? undefined })
  if (updatedFilter) model.updatedAt = updatedFilter
  return model
}

export function translationsUrlParamsToSortModel<T extends TranslationsUrlParams>(p: T): TranslationsGridSortItem[] {
  return [{ colId: p.sortField ?? 'key', sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function translationsFilterModelToSearchParams(
  model: TranslationsGridFilterModel,
  activeLanguageCodes: readonly string[] = [],
): Record<string, string | null> {
  const updatedRange = gridDateFilterToRange(model.updatedAt)
  const result = {
    ...gridTextFilterToSearchParams(model.key),
    namespace: asString(model.namespace?.value) ?? null,
    module: asString(model.module?.value) ?? null,
    language: asString(model.language?.value) ?? null,
    status: asString(model.status?.value) ?? null,
    updatedFrom: updatedRange?.from ?? null,
    updatedTo: updatedRange?.to ?? null,
  }
  addTextSearchParams(result, 'description', model.description)
  for (const code of activeLanguageCodes) addTextSearchParams(result, `value_${code}`, undefined)
  for (const colId of Object.keys(model)) {
    if (colId.startsWith('value_')) addTextSearchParams(result, colId, model[colId as `value_${string}`])
  }
  return result
}
