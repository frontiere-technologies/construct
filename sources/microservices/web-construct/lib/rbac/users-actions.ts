'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED, type UserStatusId } from './types'

async function userIsAdmin(supabase: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_role').select('user_id').eq('user_id', userId).eq('id_role', ROLE_ADMINISTRATOR).limit(1)
  if (error) throw new Error(`Failed to check admin: ${error.message}`)
  return (data ?? []).length > 0
}

async function otherAdminUserIds(supabase: ReturnType<typeof createAdminClient>, excludeUserId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_role').select('user_id').eq('id_role', ROLE_ADMINISTRATOR).neq('user_id', excludeUserId)
  if (error) throw new Error(`Failed to count admins: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)))
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  const targetCurrentlyAdmin = await userIsAdmin(supabase, userId)
  const others = await otherAdminUserIds(supabase, userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    otherAdminCount: others.length,
  })

  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  const { error: delErr } = await supabase.from('user_role').delete().eq('user_id', userId)
  if (delErr) throw new Error(`Failed to clear roles: ${delErr.message}`)
  const rows = finalRoleIds.map(id_role => ({ user_id: userId, id_role }))
  const { error: insErr } = await supabase.from('user_role').insert(rows)
  if (insErr) throw new Error(`Failed to assign roles: ${insErr.message}`)
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  let targetIsAdmin = false
  let otherActiveAdminCount = 0
  if (status === 1) {
    targetIsAdmin = await userIsAdmin(supabase, userId)
    const others = await otherAdminUserIds(supabase, userId)
    if (others.length) {
      const { count, error } = await supabase
        .from('users').select('id', { count: 'exact', head: true }).in('id', others).eq('id_user_status', 2)
      if (error) throw new Error(`Failed to count active admins: ${error.message}`)
      otherActiveAdminCount = count ?? 0
    }
  }
  assertStatusChangeAllowed({ targetUserId: userId, currentUserId, newStatus: status, targetIsAdmin, otherActiveAdminCount })

  const { error } = await supabase
    .from('users').update({ id_user_status: status, last_status_ts: new Date().toISOString() }).eq('id', userId)
  if (error) throw new Error(`Failed to update status: ${error.message}`)
}
