import type { UserDTO, UserStatusId, UsersQuery } from './types'

export interface UserRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  created_at: string
  updated_at: string | null
  id_user_status: number
}
export interface UserRoleRow { user_id: string; id_role: number }

export const USER_SORT_COLUMN: Record<NonNullable<UsersQuery['sort']>, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  dateIns: 'created_at',
  dateMod: 'updated_at',
  status: 'id_user_status',
}

export function mapUserStatus(id: number): UserDTO['status'] {
  return id === 2 ? { idUserStatus: 2, description: 'Active' } : { idUserStatus: 1, description: 'Deactivated' }
}

export function buildUserDtos(
  userRows: UserRow[],
  userRoleRows: UserRoleRow[],
  roleNameById: Map<number, string>,
): UserDTO[] {
  const rolesByUser = new Map<string, { id: number; name: string }[]>()
  for (const r of userRoleRows) {
    const arr = rolesByUser.get(r.user_id) ?? []
    arr.push({ id: r.id_role, name: roleNameById.get(r.id_role) ?? String(r.id_role) })
    rolesByUser.set(r.user_id, arr)
  }
  return userRows.map(u => ({
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    roles: (rolesByUser.get(u.id) ?? []).sort((a, b) => a.id - b.id),
    status: mapUserStatus(u.id_user_status) as { idUserStatus: UserStatusId; description: 'Active' | 'Deactivated' },
    tenantValidationPending: false as const,
    multiTenancyEnabled: false as const,
  }))
}
