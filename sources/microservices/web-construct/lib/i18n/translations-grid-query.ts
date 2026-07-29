import type { TranslationsQuery, TranslationStatusFilter } from './types'

export interface TranslationsGridFilterModel {
  key?: { filter?: string }
  namespace?: { value?: string | number }
  module?: { value?: string | number }
  language?: { value?: string | number }
  status?: { value?: string | number }
}

export interface TranslationsGridSortItem { colId: string; sort: 'asc' | 'desc' }

const asString = (v: string | number | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : String(v)

export function buildTranslationsGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: TranslationsGridSortItem[],
  filterModel: TranslationsGridFilterModel,
): TranslationsQuery {
  const sortItem = sortModel[0]
  const status = asString(filterModel.status?.value)
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.key?.filter || undefined,
    namespace: asString(filterModel.namespace?.value),
    module: asString(filterModel.module?.value),
    languageCode: asString(filterModel.language?.value),
    status: status && status !== 'all' ? (status as TranslationStatusFilter) : undefined,
    sort: (sortItem?.colId as TranslationsQuery['sort']) ?? 'key',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface TranslationsUrlParams {
  search: string
  namespace: string | null
  module: string | null
  language: string | null
  status: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function translationsUrlParamsToFilterModel(p: TranslationsUrlParams): TranslationsGridFilterModel {
  const model: TranslationsGridFilterModel = {}
  if (p.search) model.key = { filter: p.search }
  if (p.namespace) model.namespace = { value: p.namespace }
  if (p.module) model.module = { value: p.module }
  if (p.language) model.language = { value: p.language }
  if (p.status) model.status = { value: p.status }
  return model
}

export function translationsUrlParamsToSortModel(p: TranslationsUrlParams): TranslationsGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function translationsFilterModelToSearchParams(model: TranslationsGridFilterModel): Record<string, string | null> {
  return {
    search: model.key?.filter || null,
    namespace: asString(model.namespace?.value) ?? null,
    module: asString(model.module?.value) ?? null,
    language: asString(model.language?.value) ?? null,
    status: asString(model.status?.value) ?? null,
  }
}
