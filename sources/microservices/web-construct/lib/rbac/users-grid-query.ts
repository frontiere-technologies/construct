import type { UsersQuery, UserStatusId } from './types'

export interface UsersGridFilterModel {
  firstName?: { filter?: string }
  roles?: { value?: number | string }
  status?: { value?: number | string }
  dateIns?: { dateFrom?: string; dateTo?: string }
}

export interface UsersGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildUsersGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: UsersGridSortItem[],
  filterModel: UsersGridFilterModel,
): UsersQuery {
  const sortItem = sortModel[0]
  const dateFilter = filterModel.dateIns
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.firstName?.filter || undefined,
    roleIds: filterModel.roles?.value != null ? [Number(filterModel.roles.value)] : undefined,
    statuses: filterModel.status?.value != null ? [Number(filterModel.status.value) as UserStatusId] : undefined,
    createdFrom: dateFilter?.dateFrom?.slice(0, 10),
    createdTo: dateFilter?.dateTo?.slice(0, 10),
    sort: (sortItem?.colId as UsersQuery['sort']) ?? 'dateIns',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'DESC',
  }
}

export interface UsersUrlParams {
  search: string
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function usersUrlParamsToFilterModel(p: UsersUrlParams): UsersGridFilterModel {
  const model: UsersGridFilterModel = {}
  if (p.search) model.firstName = { filter: p.search }
  if (p.roleId != null) model.roles = { value: p.roleId }
  if (p.statusId != null) model.status = { value: p.statusId }
  if (p.createdFrom || p.createdTo) model.dateIns = { dateFrom: p.createdFrom ?? undefined, dateTo: p.createdTo ?? undefined }
  return model
}

export function usersUrlParamsToSortModel(p: UsersUrlParams): UsersGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function usersFilterModelToSearchParams(filterModel: UsersGridFilterModel): Record<string, string | null> {
  return {
    search: filterModel.firstName?.filter || null,
    roleIds: filterModel.roles?.value != null ? String(filterModel.roles.value) : null,
    statuses: filterModel.status?.value != null ? String(filterModel.status.value) : null,
    createdFrom: filterModel.dateIns?.dateFrom ? filterModel.dateIns.dateFrom.slice(0, 10) : null,
    createdTo: filterModel.dateIns?.dateTo ? filterModel.dateIns.dateTo.slice(0, 10) : null,
  }
}
