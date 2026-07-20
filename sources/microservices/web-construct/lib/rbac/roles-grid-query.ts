import type { RolesQuery } from './types'

export interface RolesGridFilterModel {
  description?: { filter?: string }
  hasPermissions?: { value?: string | number }
  dateIns?: { dateFrom?: string; dateTo?: string }
}

export interface RolesGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildRolesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: RolesGridSortItem[],
  filterModel: RolesGridFilterModel,
): RolesQuery {
  const sortItem = sortModel[0]
  const dateFilter = filterModel.dateIns
  const hasPermValue = filterModel.hasPermissions?.value
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.description?.filter || undefined,
    hasPermission: hasPermValue === 'true' ? true : hasPermValue === 'false' ? false : undefined,
    startDateIns: dateFilter?.dateFrom?.slice(0, 10),
    endDateIns: dateFilter?.dateTo?.slice(0, 10),
    sort: (sortItem?.colId as RolesQuery['sort']) ?? 'id',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface RolesUrlParams {
  search: string
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function rolesUrlParamsToFilterModel(p: RolesUrlParams): RolesGridFilterModel {
  const model: RolesGridFilterModel = {}
  if (p.search) model.description = { filter: p.search }
  if (p.hasPermission != null) model.hasPermissions = { value: String(p.hasPermission) }
  if (p.startDateIns || p.endDateIns) model.dateIns = { dateFrom: p.startDateIns ?? undefined, dateTo: p.endDateIns ?? undefined }
  return model
}

export function rolesUrlParamsToSortModel(p: RolesUrlParams): RolesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function rolesFilterModelToSearchParams(filterModel: RolesGridFilterModel): Record<string, string | null> {
  return {
    search: filterModel.description?.filter || null,
    hasPermission: filterModel.hasPermissions?.value != null ? String(filterModel.hasPermissions.value) : null,
    startDateIns: filterModel.dateIns?.dateFrom ? filterModel.dateIns.dateFrom.slice(0, 10) : null,
    endDateIns: filterModel.dateIns?.dateTo ? filterModel.dateIns.dateTo.slice(0, 10) : null,
  }
}
