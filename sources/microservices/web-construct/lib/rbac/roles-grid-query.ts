import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'
import {
  dateRangeToGridFilter, gridDateFilterToRange, gridNumberFilterToRange, numberRangeToGridFilter,
  type GridDateFilterModel, type GridNumberFilterModel,
} from '@/lib/grid-filter-models'
import type { RolesQuery } from './types'
import { isSupportedRbacInclusiveDateTo } from './date-utils'

export interface RolesGridFilterModel {
  id?: GridNumberFilterModel
  description?: GridTextFilterModel
  associatedUsers?: GridNumberFilterModel
  hasPermissions?: { value?: string | number }
  dateIns?: GridDateFilterModel
  dateMod?: GridDateFilterModel
}

export interface RolesGridSortItem { colId: string; sort: 'asc' | 'desc' }

function orderedRange<T extends number | string>(
  min: T | null | undefined,
  max: T | null | undefined,
): { min?: T; max?: T } | undefined {
  if (min != null && max != null && min > max) return undefined
  if (min == null && max == null) return undefined
  return {
    min: min ?? undefined,
    max: max ?? undefined,
  }
}

export function buildRolesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: RolesGridSortItem[],
  filterModel: RolesGridFilterModel,
): RolesQuery {
  const sortItem = sortModel[0]
  const idRawRange = gridNumberFilterToRange(filterModel.id)
  const associatedUsersRawRange = gridNumberFilterToRange(filterModel.associatedUsers)
  const dateInsRawRange = gridDateFilterToRange(filterModel.dateIns)
  const dateModRawRange = gridDateFilterToRange(filterModel.dateMod)
  const idRange = orderedRange(idRawRange?.min, idRawRange?.max)
  const associatedUsersRange = orderedRange(associatedUsersRawRange?.min, associatedUsersRawRange?.max)
  const dateInsRange = orderedRange(dateInsRawRange?.from, dateInsRawRange?.to)
  const dateModRange = orderedRange(dateModRawRange?.from, dateModRawRange?.to)
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
    startDateIns: dateInsRange?.min,
    endDateIns: dateInsRange?.max,
    startDateMod: dateModRange?.min,
    endDateMod: dateModRange?.max,
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

const ROLE_SORT_FIELDS = new Set<NonNullable<RolesQuery['sort']>>([
  'id', 'description', 'associatedUsers', 'hasPermissions', 'dateIns', 'dateMod',
])

function parseRolesGridDateParam(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null
}

export function parseRolesGridNumberParam(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseRolesGridUrlParams(params: Record<string, string | undefined>): RolesUrlParams {
  const sort = params.sort as RolesQuery['sort'] | undefined
  const idRange = orderedRange(
    parseRolesGridNumberParam(params.idMin),
    parseRolesGridNumberParam(params.idMax),
  )
  const associatedUsersRange = orderedRange(
    parseRolesGridNumberParam(params.associatedUsersMin),
    parseRolesGridNumberParam(params.associatedUsersMax),
  )
  const dateInsRange = orderedRange(
    parseRolesGridDateParam(params.startDateIns),
    (() => {
      const value = parseRolesGridDateParam(params.endDateIns)
      return value && isSupportedRbacInclusiveDateTo(value) ? value : null
    })(),
  )
  const dateModRange = orderedRange(
    parseRolesGridDateParam(params.startDateMod),
    (() => {
      const value = parseRolesGridDateParam(params.endDateMod)
      return value && isSupportedRbacInclusiveDateTo(value) ? value : null
    })(),
  )
  return {
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: params.searchOperator === 'AND' || params.searchOperator === 'OR' ? params.searchOperator : null,
    idMin: idRange?.min ?? null,
    idMax: idRange?.max ?? null,
    associatedUsersMin: associatedUsersRange?.min ?? null,
    associatedUsersMax: associatedUsersRange?.max ?? null,
    hasPermission: params.hasPermission === 'true' ? true : params.hasPermission === 'false' ? false : null,
    startDateIns: dateInsRange?.min ?? null,
    endDateIns: dateInsRange?.max ?? null,
    startDateMod: dateModRange?.min ?? null,
    endDateMod: dateModRange?.max ?? null,
    sortField: sort && ROLE_SORT_FIELDS.has(sort) ? sort : 'id',
    sortDir: params.direction === 'DESC' ? 'DESC' : 'ASC',
  }
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
