import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { buildAuthTree } from './permission-tree'
import {
  type RolesQuery, type RolesPage, type RolePageItemDto, type RoleInformationDto,
  type RoleType, type UserNavigationTreeDto, type NavigationItemRow,
  ROOT_ID, OPERATIONS_ID,
} from './types'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

const SORT_COLUMN: Record<NonNullable<RolesQuery['sort']>, string> = {
  id: 'id', description: 'description', associatedUsers: 'associated_users',
  hasPermissions: 'has_permissions', dateIns: 'date_ins', dateMod: 'date_mod',
}

export function applyFilters<T extends {
  ilike(column: string, value: string): T
  eq(column: string, value: unknown): T
  gte(column: string, value: unknown): T
  lte(column: string, value: unknown): T
}>(q: T, query: RolesQuery): T {
  let r = q
  if (query.search) r = r.ilike('description', `%${query.search}%`) as T
  if (query.hasPermission) r = r.eq('has_permissions', true) as T
  if (query.startDateIns) r = r.gte('date_ins', query.startDateIns) as T
  if (query.endDateIns) r = r.lte('date_ins', query.endDateIns) as T
  if (query.minAssociatedUsers != null) r = r.gte('associated_users', query.minAssociatedUsers) as T
  if (query.maxAssociatedUsers != null) r = r.lte('associated_users', query.maxAssociatedUsers) as T
  return r
}

export const listRoles = cache(async (query: RolesQuery): Promise<RolesPage> => {
  const supabase = createAdminClient()
  const sortCol = SORT_COLUMN[query.sort ?? 'id']
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  const from = query.page * query.size
  const to = from + query.size - 1

  let q = supabase.from('role_list_view').select('*', { count: 'exact' })
  q = applyFilters(q, query)
  const { data, error, count } = await q.order(sortCol, { ascending }).range(from, to)
  if (error) throw new Error(`Failed to list roles: ${error.message}`)

  const elements: RolePageItemDto[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    description: String(r.description ?? ''),
    associatedUsers: Number(r.associated_users ?? 0),
    hasPermissions: Boolean(r.has_permissions),
    dateIns: (r.date_ins as string) ?? null,
    dateMod: (r.date_mod as string) ?? null,
    roleType: (r.role_type as RoleType) ?? 'SERVICE',
  }))
  const total = count ?? 0
  return {
    pagination: {
      currentElements: elements.length,
      currentPage: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.size)),
    },
    elements,
  }
})

export const countRoles = cache(async (query: RolesQuery): Promise<number> => {
  const supabase = createAdminClient()
  let q = supabase.from('role_list_view').select('id', { count: 'exact', head: true })
  q = applyFilters(q, query)
  const { count, error } = await q
  if (error) throw new Error(`Failed to count roles: ${error.message}`)
  return count ?? 0
})

export const getAllRoles = cache(async (roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]> => {
  const supabase = createAdminClient()
  let q = supabase.from('role_list_view').select('id,description,role_type').order('description')
  if (roleTypes?.length) q = q.in('role_type', roleTypes)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load roles: ${error.message}`)
  return (data ?? []).map((r: Record<string, unknown>) => ({ id: Number(r.id), description: String(r.description ?? '') }))
})

export const getRole = cache(async (roleId: number): Promise<RoleInformationDto> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('role_list_view').select('id,description,role_type,associated_users')
    .eq('id', roleId).single()
  if (error) throw new Error(`Failed to load role: ${error.message}`)
  return {
    id: Number(data.id),
    roleName: String(data.description ?? ''),
    associatedUsersCount: Number(data.associated_users ?? 0),
    roleType: (data.role_type as RoleType) ?? 'SERVICE',
  }
})

export const getRoleAuthorizationTree = cache(
  async (roleId: number, rootName: 'ROOT' | 'OPERATIONS'): Promise<UserNavigationTreeDto[]> => {
    const supabase = createAdminClient()
    const [{ data: navRows, error: navErr }, { data: riRows, error: riErr }] = await Promise.all([
      supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
      supabase.from('role_item').select('id_item,authorized').eq('id_role', roleId),
    ])
    if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
    if (riErr) throw new Error(`Failed to load permissions: ${riErr.message}`)
    const authorized = new Set<number>(
      (riRows ?? []).filter((r: { authorized: boolean }) => r.authorized).map((r: { id_item: number }) => r.id_item)
    )
    const rootId = rootName === 'ROOT' ? ROOT_ID : OPERATIONS_ID
    return buildAuthTree((navRows ?? []) as NavigationItemRow[], authorized, rootId)
  }
)
