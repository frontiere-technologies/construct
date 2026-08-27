import { cache } from 'react'
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem, roleListView } from '@/lib/db/schema'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { toNavigationItemRow } from './nav-row-mapper'
import { buildAuthTree } from './permission-tree'
import {
  type RolesQuery, type RolesPage, type RolePageItemDto, type RoleInformationDto,
  type RoleType, type UserNavigationTreeDto,
  ROOT_ID, OPERATIONS_ID,
} from './types'
import { isSupportedRbacInclusiveDateTo, nextDay } from './date-utils'

const SORT_COLUMN = {
  id: roleListView.id,
  description: roleListView.description,
  associatedUsers: roleListView.associatedUsers,
  hasPermissions: roleListView.hasPermissions,
  dateIns: roleListView.dateIns,
  dateMod: roleListView.dateMod,
} as const

export function applyFilters(query: RolesQuery): SQL[] {
  const conditions: SQL[] = []
  const textSearch = normalizeTextSearch(query.search)
  if (textSearch) {
    const termConditions = textSearch.conditions.map(term => ilike(roleListView.description, `%${escapeLikePattern(term)}%`))
    conditions.push((textSearch.operator === 'OR' ? or(...termConditions) : and(...termConditions))!)
  }
  if (query.idMin != null) conditions.push(gte(roleListView.id, query.idMin))
  if (query.idMax != null) conditions.push(lte(roleListView.id, query.idMax))
  if (query.associatedUsersMin != null) conditions.push(gte(roleListView.associatedUsers, query.associatedUsersMin))
  if (query.associatedUsersMax != null) conditions.push(lte(roleListView.associatedUsers, query.associatedUsersMax))
  if (query.hasPermission != null) conditions.push(eq(roleListView.hasPermissions, query.hasPermission))
  if (query.startDateIns) conditions.push(gte(roleListView.dateIns, query.startDateIns))
  if (query.endDateIns) {
    if (!isSupportedRbacInclusiveDateTo(query.endDateIns)) throw new Error('endDateIns exceeds the supported inclusive upper bound')
    conditions.push(lt(roleListView.dateIns, nextDay(query.endDateIns)))
  }
  if (query.startDateMod) conditions.push(gte(roleListView.dateMod, query.startDateMod))
  if (query.endDateMod) {
    if (!isSupportedRbacInclusiveDateTo(query.endDateMod)) throw new Error('endDateMod exceeds the supported inclusive upper bound')
    conditions.push(lt(roleListView.dateMod, nextDay(query.endDateMod)))
  }
  return conditions
}

export const listRoles = cache(async (query: RolesQuery): Promise<RolesPage> => {
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  const sortCol = SORT_COLUMN[query.sort ?? 'id']
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  const from = query.page * query.size

  let rows: (typeof roleListView.$inferSelect)[]
  let total: number
  try {
    const [r, [{ value }]] = await Promise.all([
      db.select().from(roleListView).where(where).orderBy(ascending ? asc(sortCol) : desc(sortCol)).limit(query.size).offset(from),
      db.select({ value: count() }).from(roleListView).where(where),
    ])
    rows = r
    total = value
  } catch (err) {
    throw new Error(`Failed to list roles: ${err instanceof Error ? err.message : String(err)}`)
  }

  const elements: RolePageItemDto[] = rows.map(r => ({
    id: Number(r.id),
    description: String(r.description ?? ''),
    associatedUsers: Number(r.associatedUsers ?? 0),
    hasPermissions: Boolean(r.hasPermissions),
    dateIns: r.dateIns ?? null,
    dateMod: r.dateMod ?? null,
    roleType: (r.roleType as RoleType) ?? 'SERVICE',
  }))
  return {
    pagination: {
      currentElements: elements.length,
      currentPage: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.size)),
    },
    total,
    elements,
  }
})

export const countRoles = cache(async (query: RolesQuery): Promise<number> => {
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await db.select({ value: count() }).from(roleListView).where(where)
    return value
  } catch (err) {
    throw new Error(`Failed to count roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getAllRoles = cache(async (roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]> => {
  const where = roleTypes?.length ? inArray(roleListView.roleType, roleTypes) : undefined
  try {
    const rows = await db
      .select({ id: roleListView.id, description: roleListView.description })
      .from(roleListView)
      .where(where)
      .orderBy(asc(roleListView.description))
    return rows.map(r => ({ id: Number(r.id), description: String(r.description ?? '') }))
  } catch (err) {
    throw new Error(`Failed to load roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getRole = cache(async (roleId: number): Promise<RoleInformationDto> => {
  let row
  try {
    ;[row] = await db
      .select({ id: roleListView.id, description: roleListView.description, roleType: roleListView.roleType, associatedUsers: roleListView.associatedUsers })
      .from(roleListView)
      .where(eq(roleListView.id, roleId))
      .limit(1)
  } catch (err) {
    throw new Error(`Failed to load role: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!row) throw new Error('Failed to load role: not found')
  return {
    id: Number(row.id),
    roleName: String(row.description ?? ''),
    associatedUsersCount: Number(row.associatedUsers ?? 0),
    roleType: (row.roleType as RoleType) ?? 'SERVICE',
  }
})

export const getRoleAuthorizationTree = cache(
  async (roleId: number, rootName: 'ROOT' | 'OPERATIONS'): Promise<UserNavigationTreeDto[]> => {
    let navRows: (typeof navigationItem.$inferSelect)[]
    let riRows: { idItem: number; authorized: boolean }[]
    try {
      ;[navRows, riRows] = await Promise.all([
        db.select().from(navigationItem).orderBy(asc(navigationItem.orderPosition)),
        db.select({ idItem: roleItem.idItem, authorized: roleItem.authorized }).from(roleItem).where(eq(roleItem.idRole, roleId)),
      ])
    } catch (err) {
      throw new Error(`Failed to load navigation: ${err instanceof Error ? err.message : String(err)}`)
    }
    const authorized = new Set<number>(riRows.filter(r => r.authorized).map(r => r.idItem))
    const rootId = rootName === 'ROOT' ? ROOT_ID : OPERATIONS_ID
    return buildAuthTree(navRows.map(toNavigationItemRow), authorized, rootId)
  }
)
