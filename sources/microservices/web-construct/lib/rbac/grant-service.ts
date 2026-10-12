import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, roleFunctionality, rolePermission, userRole } from '@/lib/db/schema'
import type { RoleGrants } from './grant-guards'

/** I code delle righe indicate. Una categoria non ha code e non compare: la rifiuta
 *  `updateRolePermissions` per conto suo, con il proprio messaggio. */
export async function permissionCodesByIds(ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await db.select({ code: permission.code }).from(permission).where(inArray(permission.idPermission, ids))
  return rows.flatMap(row => (row.code ? [row.code] : []))
}

export async function functionalityIdsForRoles(roleIds: number[]): Promise<Set<number>> {
  if (!roleIds.length) return new Set()
  const rows = await db
    .select({ idMenuEntry: roleFunctionality.idMenuEntry })
    .from(roleFunctionality)
    .where(inArray(roleFunctionality.idRole, roleIds))
  return new Set(rows.map(row => row.idMenuEntry))
}

export async function grantsForRoles(roleIds: number[]): Promise<RoleGrants[]> {
  if (!roleIds.length) return []
  const [codes, functionalities] = await Promise.all([
    db.select({ idRole: rolePermission.idRole, code: permission.code })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
      .where(and(inArray(rolePermission.idRole, roleIds), isNull(permission.deprecatedAt))),
    db.select({ idRole: roleFunctionality.idRole, idMenuEntry: roleFunctionality.idMenuEntry })
      .from(roleFunctionality)
      .where(inArray(roleFunctionality.idRole, roleIds)),
  ])
  return roleIds.map(idRole => ({
    idRole,
    codes: codes.flatMap(row => (row.idRole === idRole && row.code ? [row.code] : [])),
    functionalityIds: functionalities.filter(row => row.idRole === idRole).map(row => row.idMenuEntry),
  }))
}

export async function currentRoleIds(userId: string): Promise<number[]> {
  const rows = await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
  return rows.map(row => row.idRole)
}
