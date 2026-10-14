'use server'

import { and, eq, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/rbac/auth-guard'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { userRole } from '@/lib/db/schema'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { roleIdsSchema, userIdSchema, userStatusSchema } from './action-input-schemas'
import { assertCanChangeRoles, assertCanChangeStatus, symmetricDifference } from './grant-guards'
import { currentRoleIds, functionalityIdsForRoles, grantsForRoles } from './grant-service'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import type { UserStatusId } from './types'

async function userIsAdmin(tx: TenantTx, userId: string, tenantAdminId: number): Promise<boolean> {
  try {
    const rows = await tx
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.idRole, tenantAdminId)))
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
  const actor = await requirePermission('assign-user-roles')
  // Gli argomenti sono JSON arbitrario: un id ruolo stringa sfuggirebbe ai confronti di identità
  // dei controlli di scalata e verrebbe poi scritto dal cast ::bigint[].
  if (!userIdSchema.safeParse(userId).success || !roleIdsSchema.safeParse(roleIds).success) {
    throw new Error('Invalid input')
  }
  const currentUserId = actor.userId
  await withTenant(actor.tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    const targetCurrentlyAdmin = await userIsAdmin(tx, userId, system.tenantAdmin)
    assertRoleChangeAllowed({
      targetUserId: userId,
      currentUserId,
      targetCurrentlyAdmin,
      newRolesIncludeAdmin: roleIds.includes(system.tenantAdmin),
      // The database function performs the authoritative serialized count. This
      // value is only for the independent self-demotion UX guard.
      otherActiveAdminCount: 1,
    })

    const finalRoleIds = Array.from(new Set<number>([system.registered, ...roleIds]))
    if (!actor.isAdmin) {
      const touched = symmetricDifference(await currentRoleIds(tx, userId), finalRoleIds)
      const visible = await functionalityIdsForRoles(tx, actor.roleIds)
      const grants = await grantsForRoles(tx, touched)
      assertCanChangeRoles(actor, visible, grants, system.tenantAdmin)
    }
    try {
      const roleIdsArray = `{${finalRoleIds.join(',')}}`
      await tx.execute(sql`select public.replace_user_roles_guarded(${userId}, ${roleIdsArray}::bigint[])`)
    } catch (err) {
      if (isLastAdministratorConflict(err)) throw new Error("Non puoi rimuovere l'ultimo amministratore attivo")
      throw new Error(`Failed to assign roles: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const actor = await requirePermission('set-user-status')
  if (!userIdSchema.safeParse(userId).success || !userStatusSchema.safeParse(status).success) {
    throw new Error('Invalid input')
  }
  const currentUserId = actor.userId
  assertStatusChangeAllowed({
    targetUserId: userId,
    currentUserId,
    newStatus: status,
    // The database function performs the authoritative serialized check.
    targetIsAdmin: false,
    otherActiveAdminCount: 1,
  })

  await withTenant(actor.tenantId, async tx => {
    if (!actor.isAdmin) {
      const system = await getSystemRoleIds(tx)
      assertCanChangeStatus(actor, await userIsAdmin(tx, userId, system.tenantAdmin))
    }

    try {
      await tx.execute(sql`select public.set_user_status_guarded(${userId}, ${status})`)
    } catch (err) {
      if (isLastAdministratorConflict(err)) throw new Error("Non puoi disattivare l'ultimo amministratore attivo")
      throw new Error(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
