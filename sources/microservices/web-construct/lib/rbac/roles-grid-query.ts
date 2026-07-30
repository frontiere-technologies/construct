import type { RolesQuery } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'
import {
  dateRangeToGridFilter, gridDateFilterToRange, gridNumberFilterToRange, numberRangeToGridFilter,
  type GridDateFilterModel, type GridNumberFilterModel,
} from '@/lib/grid-filter-models'

export interface RolesGridFilterModel {
  id?: GridNumberFilterModel
  description?: GridTextFilterModel
  associatedUsers?: GridNumberFilterModel
  hasPermissions?: { value?: string | number }
  dateIns?: GridDateFilterModel
  dateMod?: GridDateFilterModel
}

export interface RolesGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildRolesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: RolesGridSortItem[],
  filterModel: RolesGridFilterModel,
): RolesQuery {
  const sortItem = sortModel[0]
  const idRange = gridNumberFilterToRange(filterModel.id)
  const associatedUsersRange = gridNumberFilterToRange(filterModel.associatedUsers)
  const dateInsRange = gridDateFilterToRange(filterModel.dateIns)
  const dateModRange = gridDateFilterToRange(filterModel.dateMod)
  const hasPermValue = filterModel.hasPermissions?.value
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: gridTextFilterToSearch(filterModel.description),
    idMin: idRange?.min,
    idMax: idRange?.max,
    associatedUsersMin: associatedUsersRange?.min,
    associatedUsersMax: associatedUsersRange?.max,
    hasPermission: hasPermValue === 'true' ? true : hasPermValue === 'false' ? false : undefined,
    startDateIns: dateInsRange?.from,
    endDateIns: dateInsRange?.to,
    startDateMod: dateModRange?.from,
    endDateMod: dateModRange?.to,
    sort: (sortItem?.colId as RolesQuery['sort']) ?? 'id',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface RolesUrlParams {
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  idMin?: number | null
  idMax?: number | null
  associatedUsersMin?: number | null
  associatedUsersMax?: number | null
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
  startDateMod?: string | null
  endDateMod?: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function parseRolesGridNumberParam(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function rolesUrlParamsToFilterModel(p: RolesUrlParams): RolesGridFilterModel {
  const model: RolesGridFilterModel = {}
  const textFilter = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  if (textFilter) model.description = textFilter
  const idFilter = numberRangeToGridFilter({ min: p.idMin ?? undefined, max: p.idMax ?? undefined })
  const associatedUsersFilter = numberRangeToGridFilter({ min: p.associatedUsersMin ?? undefined, max: p.associatedUsersMax ?? undefined })
  if (idFilter) model.id = idFilter
  if (associatedUsersFilter) model.associatedUsers = associatedUsersFilter
  if (p.hasPermission != null) model.hasPermissions = { value: String(p.hasPermission) }
  const dateInsFilter = dateRangeToGridFilter({ from: p.startDateIns ?? undefined, to: p.endDateIns ?? undefined })
  const dateModFilter = dateRangeToGridFilter({ from: p.startDateMod ?? undefined, to: p.endDateMod ?? undefined })
  if (dateInsFilter) model.dateIns = dateInsFilter
  if (dateModFilter) model.dateMod = dateModFilter
  return model
}

export function rolesUrlParamsToSortModel(p: RolesUrlParams): RolesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function rolesFilterModelToSearchParams(filterModel: RolesGridFilterModel): Record<string, string | null> {
  const idRange = gridNumberFilterToRange(filterModel.id)
  const associatedUsersRange = gridNumberFilterToRange(filterModel.associatedUsers)
  const dateInsRange = gridDateFilterToRange(filterModel.dateIns)
  const dateModRange = gridDateFilterToRange(filterModel.dateMod)
  return {
    ...gridTextFilterToSearchParams(filterModel.description),
    idMin: idRange?.min != null ? String(idRange.min) : null,
    idMax: idRange?.max != null ? String(idRange.max) : null,
    associatedUsersMin: associatedUsersRange?.min != null ? String(associatedUsersRange.min) : null,
    associatedUsersMax: associatedUsersRange?.max != null ? String(associatedUsersRange.max) : null,
    hasPermission: filterModel.hasPermissions?.value != null ? String(filterModel.hasPermissions.value) : null,
    startDateIns: dateInsRange?.from ?? null,
    endDateIns: dateInsRange?.to ?? null,
    startDateMod: dateModRange?.from ?? null,
    endDateMod: dateModRange?.to ?? null,
  }
}
