import type { LanguagesQuery } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'

export interface LanguagesGridFilterModel {
  name?: GridTextFilterModel
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
    search: gridTextFilterToSearch(filterModel.name),
    isActive: activeValue === 'true' ? true : activeValue === 'false' ? false : undefined,
    sort: (sortItem?.colId as LanguagesQuery['sort']) ?? 'code',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface LanguagesUrlParams {
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  isActive: boolean | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function languagesUrlParamsToFilterModel(p: LanguagesUrlParams): LanguagesGridFilterModel {
  const model: LanguagesGridFilterModel = {}
  const textFilter = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  if (textFilter) model.name = textFilter
  if (p.isActive != null) model.isActive = { value: String(p.isActive) }
  return model
}

export function languagesUrlParamsToSortModel(p: LanguagesUrlParams): LanguagesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function languagesFilterModelToSearchParams(model: LanguagesGridFilterModel): Record<string, string | null> {
  return {
    ...gridTextFilterToSearchParams(model.name),
    isActive: model.isActive?.value != null ? String(model.isActive.value) : null,
  }
}
