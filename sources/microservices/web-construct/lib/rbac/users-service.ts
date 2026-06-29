import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { getAllRoles } from './roles-service'
import { USER_SORT_COLUMN, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'
import type { UserDTO, UsersQuery } from './types'

const USER_COLUMNS = 'id,first_name,last_name,email,created_at,updated_at,id_user_status'

type FilterableQuery = {
  ilike(column: string, value: string): FilterableQuery
  or(filters: string): FilterableQuery
  in(column: string, values: readonly unknown[]): FilterableQuery
  gte(column: string, value: unknown): FilterableQuery
  lte(column: string, value: unknown): FilterableQuery
}

async function candidateUserIds(roleIds: number[] | undefined): Promise<string[] | null> {
  if (!roleIds?.length) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('user_role').select('user_id').in('id_role', roleIds)
  if (error) throw new Error(`Failed to filter by role: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)))
}

function applyUserFilters<T extends FilterableQuery>(q: T, query: UsersQuery, ids: string[] | null): T {
  let r = q
  if (query.search) {
    const s = query.search.replace(/[%,]/g, '')
    r = r.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`) as T
  }
  if (query.statuses?.length) r = r.in('id_user_status', query.statuses) as T
  if (query.createdFrom) r = r.gte('created_at', query.createdFrom) as T
  if (query.createdTo) r = r.lte('created_at', query.createdTo) as T
  if (ids) r = r.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) as T
  return r
}

export const listUsers = cache(async (query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> => {
  const supabase = createAdminClient()
  const ids = await candidateUserIds(query.roleIds)
  const sortCol = USER_SORT_COLUMN[query.sort ?? 'dateIns']
  const ascending = (query.direction ?? 'DESC') === 'ASC'
  const from = query.page * query.size
  const to = from + query.size - 1

  let q = supabase.from('users').select(USER_COLUMNS, { count: 'exact' })
  q = applyUserFilters(q as unknown as FilterableQuery, query, ids) as unknown as typeof q
  const { data, error, count } = await q.order(sortCol, { ascending }).range(from, to)
  if (error) throw new Error(`Failed to list users: ${error.message}`)
  const userRows = (data ?? []) as unknown as UserRow[]

  const pageIds = userRows.map(u => u.id)
  let userRoleRows: UserRoleRow[] = []
  if (pageIds.length) {
    const { data: ur, error: urErr } = await supabase.from('user_role').select('user_id,id_role').in('user_id', pageIds)
    if (urErr) throw new Error(`Failed to load user roles: ${urErr.message}`)
    userRoleRows = (ur ?? []) as UserRoleRow[]
  }
  const allRoles = await getAllRoles()
  const roleNameById = new Map<number, string>(allRoles.map(r => [r.id, r.description]))
  return { users: buildUserDtos(userRows, userRoleRows, roleNameById), total: count ?? 0 }
})

export const countUsers = cache(async (query: UsersQuery): Promise<number> => {
  const supabase = createAdminClient()
  const ids = await candidateUserIds(query.roleIds)
  let q = supabase.from('users').select('id', { count: 'exact', head: true })
  q = applyUserFilters(q as unknown as FilterableQuery, query, ids) as unknown as typeof q
  const { count, error } = await q
  if (error) throw new Error(`Failed to count users: ${error.message}`)
  return count ?? 0
})
