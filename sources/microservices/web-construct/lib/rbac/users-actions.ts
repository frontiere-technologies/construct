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

// Count OTHER admins (excluding the target) whose account is Active. Both the
// role-removal and the deactivation lockouts use this so neither can leave the
// system without a usable (active) administrator.
async function countOtherActiveAdmins(supabase: ReturnType<typeof createAdminClient>, excludeUserId: string): Promise<number> {
  const others = await otherAdminUserIds(supabase, excludeUserId)
  if (!others.length) return 0
  const { count, error } = await supabase
    .from('users').select('id', { count: 'exact', head: true }).in('id', others).eq('id_user_status', 2)
  if (error) throw new Error(`Failed to count active admins: ${error.message}`)
  return count ?? 0
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  const targetCurrentlyAdmin = await userIsAdmin(supabase, userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    otherActiveAdminCount: await countOtherActiveAdmins(supabase, userId),
  })

  // Atomic full replace via RPC (delete + insert in one transaction) — no manual
  // rollback needed; a failed insert rolls back the delete (CARRY-P3-1 resolved).
  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  const { error } = await supabase.rpc('replace_user_roles', { p_user_id: userId, p_role_ids: finalRoleIds })
  if (error) throw new Error(`Failed to assign roles: ${error.message}`)
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  let targetIsAdmin = false
  let otherActiveAdminCount = 0
  if (status === 1) {
    targetIsAdmin = await userIsAdmin(supabase, userId)
    otherActiveAdminCount = await countOtherActiveAdmins(supabase, userId)
  }
  assertStatusChangeAllowed({ targetUserId: userId, currentUserId, newStatus: status, targetIsAdmin, otherActiveAdminCount })

  const { error } = await supabase
    .from('users').update({ id_user_status: status, last_status_ts: new Date().toISOString() }).eq('id', userId)
  if (error) throw new Error(`Failed to update status: ${error.message}`)
}
