import { cache } from 'react'
import { and, asc, desc, count, eq, exists, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, userRole } from '@/lib/db/schema'
import { escapeLikePattern, normalizeTextSearch } from '@/lib/grid-text-search'
import { getAllRoles } from './roles-service'
import { isSupportedRbacInclusiveDateTo, nextDay } from './date-utils'
import { USER_SORT_COLUMN, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'
import type { UserDto, UsersQuery } from './types'

const SORT_COLUMNS = {
  first_name: users.firstName,
  last_name: users.lastName,
  email: users.email,
  created_at: users.createdAt,
  updated_at: users.updatedAt,
  id_user_status: users.idUserStatus,
} as const

function textSearchCondition(
  search: UsersQuery['nameSearch'],
  columns: Parameters<typeof ilike>[0][],
): SQL | undefined {
  const textSearch = normalizeTextSearch(search)
  if (!textSearch) return undefined
  const termConditions = textSearch.conditions.map(term => {
    const matches = columns.map(column => sql`${column} ilike ${`%${escapeLikePattern(term)}%`} escape '\\'`)
    return matches.length === 1 ? matches[0] : or(...matches)!
  })
  return textSearch.operator === 'OR' ? or(...termConditions)! : and(...termConditions)!
}

export function applyUserFilters(query: UsersQuery, roleIds: number[] | undefined): SQL[] {
  const conditions: SQL[] = []
  const nameCondition = textSearchCondition(query.nameSearch, [users.firstName, users.lastName])
  const emailCondition = textSearchCondition(query.emailSearch, [users.email])
  if (nameCondition) conditions.push(nameCondition)
  if (emailCondition) conditions.push(emailCondition)
  if (query.statuses?.length) conditions.push(inArray(users.idUserStatus, query.statuses))
  if (query.createdFrom) conditions.push(gte(users.createdAt, query.createdFrom))
  if (query.createdTo) {
    if (!isSupportedRbacInclusiveDateTo(query.createdTo)) throw new Error('createdTo exceeds the supported inclusive upper bound')
    conditions.push(lt(users.createdAt, nextDay(query.createdTo)))
  }
  if (query.updatedFrom) conditions.push(gte(users.updatedAt, query.updatedFrom))
  if (query.updatedTo) {
    if (!isSupportedRbacInclusiveDateTo(query.updatedTo)) throw new Error('updatedTo exceeds the supported inclusive upper bound')
    conditions.push(lt(users.updatedAt, nextDay(query.updatedTo)))
  }
  if (roleIds?.length) {
    conditions.push(exists(
      db.select({ one: sql`1` })
        .from(userRole)
        .where(and(eq(userRole.userId, users.id), inArray(userRole.idRole, roleIds))),
    ))
  }
  return conditions
}

export const listUsers = cache(async (query: UsersQuery): Promise<{ users: UserDto[]; total: number }> => {
  const conditions = applyUserFilters(query, query.roleIds)
  const where = conditions.length ? and(...conditions) : undefined
  const ascending = (query.direction ?? 'DESC') === 'ASC'
  const from = query.page * query.size
  const sortCol = SORT_COLUMNS[USER_SORT_COLUMN[query.sort ?? 'dateIns'] as keyof typeof SORT_COLUMNS]
  const orderBy = query.sort === 'firstName'
    ? [ascending ? asc(users.firstName) : desc(users.firstName), ascending ? asc(users.lastName) : desc(users.lastName), ascending ? asc(users.email) : desc(users.email)]
    : [ascending ? asc(sortCol) : desc(sortCol)]

  let userRows: UserRow[]
  let total: number
  try {
    const [rows, [{ value }]] = await Promise.all([
      db
        .select({
          id: users.id, first_name: users.firstName, last_name: users.lastName, email: users.email,
          created_at: users.createdAt, updated_at: users.updatedAt, id_user_status: users.idUserStatus,
        })
        .from(users)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.size)
        .offset(from),
      db.select({ value: count() }).from(users).where(where),
    ])
    userRows = rows as unknown as UserRow[]
    total = value
  } catch (err) {
    throw new Error(`Failed to list users: ${err instanceof Error ? err.message : String(err)}`)
  }

  const pageIds = userRows.map(u => u.id)
  let userRoleRows: UserRoleRow[] = []
  if (pageIds.length) {
    try {
      const ur = await db.select({ user_id: userRole.userId, id_role: userRole.idRole }).from(userRole).where(inArray(userRole.userId, pageIds))
      userRoleRows = ur as UserRoleRow[]
    } catch (err) {
      throw new Error(`Failed to load user roles: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const allRoles = await getAllRoles()
  const roleNameById = new Map<number, string>(allRoles.map(r => [r.id, r.description]))
  return { users: buildUserDtos(userRows, userRoleRows, roleNameById), total }
})

export const countUsers = cache(async (query: UsersQuery): Promise<number> => {
  const conditions = applyUserFilters(query, query.roleIds)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await db.select({ value: count() }).from(users).where(where)
    return value
  } catch (err) {
    throw new Error(`Failed to count users: ${err instanceof Error ? err.message : String(err)}`)
  }
})
