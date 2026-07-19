'use server'

import { and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { users, userRole } from '@/lib/db/schema'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED, type UserStatusId, type UserDTO, type UsersQuery } from './types'
import { listUsers } from './users-service'

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

async function otherAdminUserIds(excludeUserId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.idRole, ROLE_ADMINISTRATOR), ne(userRole.userId, excludeUserId)))
    return Array.from(new Set(rows.map(r => r.userId)))
  } catch (err) {
    throw new Error(`Failed to count admins: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Count OTHER admins (excluding the target) whose account is Active. Both the
// role-removal and the deactivation lockouts use this so neither can leave the
// system without a usable (active) administrator.
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  const others = await otherAdminUserIds(excludeUserId)
  if (!others.length) return 0
  try {
    const [{ value }] = await db.select({ value: count() }).from(users).where(and(inArray(users.id, others), eq(users.idUserStatus, 2)))
    return value
  } catch (err) {
    throw new Error(`Failed to count active admins: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const targetCurrentlyAdmin = await userIsAdmin(userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    otherActiveAdminCount: await countOtherActiveAdmins(userId),
  })

  // Atomic full replace via RPC (delete + insert in one transaction) — schema.sql function, DEC-3.
  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  try {
    const roleIdsArray = `{${finalRoleIds.join(',')}}`
    await db.execute(sql`select public.replace_user_roles(${userId}, ${roleIdsArray}::bigint[])`)
  } catch (err) {
    throw new Error(`Failed to assign roles: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  let targetIsAdmin = false
  let otherActiveAdminCount = 0
  if (status === 1) {
    targetIsAdmin = await userIsAdmin(userId)
    otherActiveAdminCount = await countOtherActiveAdmins(userId)
  }
  assertStatusChangeAllowed({ targetUserId: userId, currentUserId, newStatus: status, targetIsAdmin, otherActiveAdminCount })

  try {
    await db.update(users).set({ idUserStatus: status, lastStatusTs: new Date().toISOString() }).where(eq(users.id, userId))
  } catch (err) {
    throw new Error(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function fetchUsersGridPage(query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> {
  await requireAdmin()
  return listUsers(query)
}
