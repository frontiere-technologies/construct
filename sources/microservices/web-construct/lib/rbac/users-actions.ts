'use server'

import { and, eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { userRole } from '@/lib/db/schema'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED, type UserStatusId } from './types'

async function userIsAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.idRole, ROLE_ADMINISTRATOR)))
      .limit(1)
    return rows.length > 0
  } catch (err) {
    throw new Error(`Failed to check admin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function isLastAdministratorConflict(error: unknown): boolean {
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('message' in current && String(current.message).includes('last_active_administrator')) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const targetCurrentlyAdmin = await userIsAdmin(userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    // The database function performs the authoritative serialized count. This
    // value is only for the independent self-demotion UX guard.
    otherActiveAdminCount: 1,
  })

  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  try {
    const roleIdsArray = `{${finalRoleIds.join(',')}}`
    await db.execute(sql`select public.replace_user_roles_guarded(${userId}, ${roleIdsArray}::bigint[])`)
  } catch (err) {
    if (isLastAdministratorConflict(err)) throw new Error("Non puoi rimuovere l'ultimo amministratore attivo")
    throw new Error(`Failed to assign roles: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  assertStatusChangeAllowed({
    targetUserId: userId,
    currentUserId,
    newStatus: status,
    // The database function performs the authoritative serialized check.
    targetIsAdmin: false,
    otherActiveAdminCount: 1,
  })

  try {
    await db.execute(sql`select public.set_user_status_guarded(${userId}, ${status})`)
  } catch (err) {
    if (isLastAdministratorConflict(err)) throw new Error("Non puoi disattivare l'ultimo amministratore attivo")
    throw new Error(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`)
  }
}
