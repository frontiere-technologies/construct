import { cache } from 'react'
import { and, asc, desc, count, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, userRole } from '@/lib/db/schema'
import { getAllRoles } from './roles-service'
import { nextDay } from './date-utils'
import { USER_SORT_COLUMN, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'
import type { UserDTO, UsersQuery } from './types'

const SORT_COLUMNS = {
  first_name: users.firstName,
  last_name: users.lastName,
  email: users.email,
  created_at: users.createdAt,
  updated_at: users.updatedAt,
  id_user_status: users.idUserStatus,
} as const

async function candidateUserIds(roleIds: number[] | undefined): Promise<string[] | null> {
  if (!roleIds?.length) return null
  try {
    const rows = await db.select({ userId: userRole.userId }).from(userRole).where(inArray(userRole.idRole, roleIds))
    return Array.from(new Set(rows.map(r => r.userId)))
  } catch (err) {
    throw new Error(`Failed to filter by role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function applyUserFilters(query: UsersQuery, ids: string[] | null): SQL[] {
  const conditions: SQL[] = []
  if (query.search) {
    const s = query.search.replace(/[%,()&]/g, '')
    conditions.push(or(
      ilike(users.firstName, `%${s}%`),
      ilike(users.lastName, `%${s}%`),
      ilike(users.email, `%${s}%`),
    )!)
  }
  if (query.statuses?.length) conditions.push(inArray(users.idUserStatus, query.statuses))
  if (query.createdFrom) conditions.push(gte(users.createdAt, query.createdFrom))
  if (query.createdTo) conditions.push(lt(users.createdAt, nextDay(query.createdTo)))
  if (ids) conditions.push(inArray(users.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
  return conditions
}

export const listUsers = cache(async (query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> => {
  const ids = await candidateUserIds(query.roleIds)
  const conditions = applyUserFilters(query, ids)
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
  const ids = await candidateUserIds(query.roleIds)
  const conditions = applyUserFilters(query, ids)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await db.select({ value: count() }).from(users).where(where)
    return value
  } catch (err) {
    throw new Error(`Failed to count users: ${err instanceof Error ? err.message : String(err)}`)
  }
})
