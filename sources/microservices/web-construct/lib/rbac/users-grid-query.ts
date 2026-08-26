import {
  gridTextFilterToSearch, gridTextFilterToSearchParams,
  searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'
import { dateRangeToGridFilter, gridDateFilterToRange, type GridDateFilterModel } from '@/lib/grid-filter-models'
import type { UsersQuery, UserStatusId } from './types'
import { isSupportedRbacInclusiveDateTo } from './date-utils'

export interface UsersGridFilterModel {
  firstName?: GridTextFilterModel
  email?: GridTextFilterModel
  roles?: { value?: number | string }
  status?: { value?: number | string }
  dateIns?: GridDateFilterModel
  dateMod?: GridDateFilterModel
}

export interface UsersGridSortItem { colId: string; sort: 'asc' | 'desc' }

const USER_SORT_FIELDS = new Set<NonNullable<UsersQuery['sort']>>([
  'firstName', 'lastName', 'email', 'dateIns', 'dateMod', 'status',
])

function orderedDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): { from?: string; to?: string } | undefined {
  if (from != null && to != null && from > to) return undefined
  if (from == null && to == null) return undefined
  return { from: from ?? undefined, to: to ?? undefined }
}

export function buildUsersGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: UsersGridSortItem[],
  filterModel: UsersGridFilterModel,
): UsersQuery {
  const sortItem = sortModel[0]
  const createdRawRange = gridDateFilterToRange(filterModel.dateIns)
  const updatedRawRange = gridDateFilterToRange(filterModel.dateMod)
  const createdDateRange = orderedDateRange(createdRawRange?.from, createdRawRange?.to)
  const updatedDateRange = orderedDateRange(updatedRawRange?.from, updatedRawRange?.to)
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    nameSearch: gridTextFilterToSearch(filterModel.firstName),
    emailSearch: gridTextFilterToSearch(filterModel.email),
    roleIds: filterModel.roles?.value != null ? [Number(filterModel.roles.value)] : undefined,
    statuses: filterModel.status?.value != null ? [Number(filterModel.status.value) as UserStatusId] : undefined,
    createdFrom: createdDateRange?.from,
    createdTo: createdDateRange?.to,
    updatedFrom: updatedDateRange?.from,
    updatedTo: updatedDateRange?.to,
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

export function parseUsersGridDateParam(value: string | undefined, inclusiveUpper = false): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return !inclusiveUpper || isSupportedRbacInclusiveDateTo(value) ? value : null
}

export function parseUsersGridStatusParam(value: string | undefined): UserStatusId | null {
  const parsed = parseUsersGridIntegerParam(value)
  return parsed === 1 || parsed === 2 ? parsed : null
}

export function parseUsersGridUrlParams(params: Record<string, string | undefined>): UsersUrlParams {
  const sort = params.sort as UsersQuery['sort'] | undefined
  const createdRange = orderedDateRange(
    parseUsersGridDateParam(params.createdFrom),
    parseUsersGridDateParam(params.createdTo, true),
  )
  const updatedRange = orderedDateRange(
    parseUsersGridDateParam(params.updatedFrom),
    parseUsersGridDateParam(params.updatedTo, true),
  )

  return {
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: params.searchOperator === 'AND' || params.searchOperator === 'OR'
      ? params.searchOperator
      : null,
    emailSearch: params.emailSearch ?? '',
    emailSearch2: params.emailSearch2 ?? '',
    emailSearchOperator: params.emailSearchOperator === 'AND' || params.emailSearchOperator === 'OR'
      ? params.emailSearchOperator
      : null,
    roleId: parseUsersGridIntegerParam(params.roleIds),
    statusId: parseUsersGridStatusParam(params.statuses),
    createdFrom: createdRange?.from ?? null,
    createdTo: createdRange?.to ?? null,
    updatedFrom: updatedRange?.from ?? null,
    updatedTo: updatedRange?.to ?? null,
    sortField: sort && USER_SORT_FIELDS.has(sort) ? sort : 'dateIns',
    sortDir: params.direction === 'ASC' ? 'ASC' : 'DESC',
  }
}

export function usersUrlParamsToFilterModel(p: UsersUrlParams): UsersGridFilterModel {
  const model: UsersGridFilterModel = {}
  const nameTextFilter = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  const emailTextFilter = searchParamsToGridTextFilter(p.emailSearch ?? '', p.emailSearch2, p.emailSearchOperator)
  if (nameTextFilter) model.firstName = nameTextFilter
  if (emailTextFilter) model.email = emailTextFilter
  if (p.roleId != null) model.roles = { value: p.roleId }
  if (p.statusId != null) model.status = { value: p.statusId }
  const createdFilter = dateRangeToGridFilter({ from: p.createdFrom ?? undefined, to: p.createdTo ?? undefined })
  const updatedFilter = dateRangeToGridFilter({ from: p.updatedFrom ?? undefined, to: p.updatedTo ?? undefined })
  if (createdFilter) model.dateIns = createdFilter
  if (updatedFilter) model.dateMod = updatedFilter
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
    createdFrom: gridDateFilterToRange(filterModel.dateIns)?.from ?? null,
    createdTo: gridDateFilterToRange(filterModel.dateIns)?.to ?? null,
    updatedFrom: gridDateFilterToRange(filterModel.dateMod)?.from ?? null,
    updatedTo: gridDateFilterToRange(filterModel.dateMod)?.to ?? null,
  }
}
