import type { UsersQuery, UserStatusId } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams,
  searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'

export interface UsersGridFilterModel {
  firstName?: GridTextFilterModel
  email?: GridTextFilterModel
  roles?: { value?: number | string }
  status?: { value?: number | string }
  dateIns?: { dateFrom?: string; dateTo?: string }
  dateMod?: { dateFrom?: string; dateTo?: string }
}

export interface UsersGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildUsersGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: UsersGridSortItem[],
  filterModel: UsersGridFilterModel,
): UsersQuery {
  const sortItem = sortModel[0]
  const createdDateFilter = filterModel.dateIns
  const updatedDateFilter = filterModel.dateMod
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    nameSearch: gridTextFilterToSearch(filterModel.firstName),
    emailSearch: gridTextFilterToSearch(filterModel.email),
    roleIds: filterModel.roles?.value != null ? [Number(filterModel.roles.value)] : undefined,
    statuses: filterModel.status?.value != null ? [Number(filterModel.status.value) as UserStatusId] : undefined,
    createdFrom: createdDateFilter?.dateFrom?.slice(0, 10),
    createdTo: createdDateFilter?.dateTo?.slice(0, 10),
    updatedFrom: updatedDateFilter?.dateFrom?.slice(0, 10),
    updatedTo: updatedDateFilter?.dateTo?.slice(0, 10),
    sort: (sortItem?.colId as UsersQuery['sort']) ?? 'dateIns',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'DESC',
  }
}

export interface UsersUrlParams {
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  emailSearch?: string
  emailSearch2?: string
  emailSearchOperator?: TextSearchOperator | null
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
  updatedFrom?: string | null
  updatedTo?: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function parseUsersGridIntegerParam(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.split(',')[0])
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null
}

export function parseUsersGridStatusParam(value: string | undefined): UserStatusId | null {
  const parsed = parseUsersGridIntegerParam(value)
  return parsed === 1 || parsed === 2 ? parsed : null
}

export function usersUrlParamsToFilterModel(p: UsersUrlParams): UsersGridFilterModel {
  const model: UsersGridFilterModel = {}
  const nameTextFilter = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  const emailTextFilter = searchParamsToGridTextFilter(p.emailSearch ?? '', p.emailSearch2, p.emailSearchOperator)
  if (nameTextFilter) model.firstName = nameTextFilter
  if (emailTextFilter) model.email = emailTextFilter
  if (p.roleId != null) model.roles = { value: p.roleId }
  if (p.statusId != null) model.status = { value: p.statusId }
  if (p.createdFrom || p.createdTo) model.dateIns = { dateFrom: p.createdFrom ?? undefined, dateTo: p.createdTo ?? undefined }
  if (p.updatedFrom || p.updatedTo) model.dateMod = { dateFrom: p.updatedFrom ?? undefined, dateTo: p.updatedTo ?? undefined }
  return model
}

export function usersUrlParamsToSortModel(p: UsersUrlParams): UsersGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function usersFilterModelToSearchParams(filterModel: UsersGridFilterModel): Record<string, string | null> {
  const emailSearchParams = gridTextFilterToSearchParams(filterModel.email)
  return {
    ...gridTextFilterToSearchParams(filterModel.firstName),
    emailSearch: emailSearchParams.search,
    emailSearch2: emailSearchParams.search2,
    emailSearchOperator: emailSearchParams.searchOperator,
    roleIds: filterModel.roles?.value != null ? String(filterModel.roles.value) : null,
    statuses: filterModel.status?.value != null ? String(filterModel.status.value) : null,
    createdFrom: filterModel.dateIns?.dateFrom ? filterModel.dateIns.dateFrom.slice(0, 10) : null,
    createdTo: filterModel.dateIns?.dateTo ? filterModel.dateIns.dateTo.slice(0, 10) : null,
    updatedFrom: filterModel.dateMod?.dateFrom ? filterModel.dateMod.dateFrom.slice(0, 10) : null,
    updatedTo: filterModel.dateMod?.dateTo ? filterModel.dateMod.dateTo.slice(0, 10) : null,
  }
}
