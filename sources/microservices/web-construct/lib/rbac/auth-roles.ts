import { createAdminClient } from '@/lib/supabase-server'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

/**
 * Ensures the user has the Registered-user role, then returns all role ids.
 * Called from the NextAuth jwt callback once the user id is known.
 */
export async function resolveUserRoleIds(userId: string): Promise<number[]> {
  const supabase = createAdminClient()
  await supabase
    .from('user_role')
    .upsert({ user_id: userId, id_role: ROLE_REGISTERED }, { onConflict: 'user_id,id_role', ignoreDuplicates: true })
  const { data, error } = await supabase
    .from('user_role')
    .select('id_role')
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to resolve roles: ${error.message}`)
  return (data ?? []).map((r: { id_role: number }) => r.id_role)
}
