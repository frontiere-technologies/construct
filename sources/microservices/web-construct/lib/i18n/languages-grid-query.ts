import type { LanguagesQuery } from './types'

export interface LanguagesGridFilterModel {
  name?: { filter?: string }
  isActive?: { value?: string | number }
}

export interface LanguagesGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildLanguagesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: LanguagesGridSortItem[],
  filterModel: LanguagesGridFilterModel,
): LanguagesQuery {
  const sortItem = sortModel[0]
  const activeValue = filterModel.isActive?.value
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.name?.filter || undefined,
    isActive: activeValue === 'true' ? true : activeValue === 'false' ? false : undefined,
    sort: (sortItem?.colId as LanguagesQuery['sort']) ?? 'code',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface LanguagesUrlParams {
  search: string
  isActive: boolean | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function languagesUrlParamsToFilterModel(p: LanguagesUrlParams): LanguagesGridFilterModel {
  const model: LanguagesGridFilterModel = {}
  if (p.search) model.name = { filter: p.search }
  if (p.isActive != null) model.isActive = { value: String(p.isActive) }
  return model
}

export function languagesUrlParamsToSortModel(p: LanguagesUrlParams): LanguagesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function languagesFilterModelToSearchParams(model: LanguagesGridFilterModel): Record<string, string | null> {
  return {
    search: model.name?.filter || null,
    isActive: model.isActive?.value != null ? String(model.isActive.value) : null,
  }
}
