'use server'

import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { role, roleType } from '@/lib/db/schema'
import type { PermissionDelta, RoleType as RoleTypeStr } from './types'

const ROLE_TYPE_SERVICE = 2

async function getRoleType(roleId: number): Promise<RoleTypeStr> {
  // Embedded-resource select (PostgREST `role_type:role_type(description)`) becomes an
  // explicit leftJoin (spec §2 pattern 5).
  let row: { description: string | null } | undefined
  try {
    ;[row] = await db
      .select({ description: roleType.description })
      .from(role)
      .leftJoin(roleType, eq(role.idRoleType, roleType.idRoleType))
      .where(eq(role.idRole, roleId))
      .limit(1)
  } catch (err) {
    throw new Error(`Role not found: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!row) throw new Error('Role not found: no rows')
  return (row.description as RoleTypeStr) ?? 'SYSTEM'
}

export async function createRole(roleName: string): Promise<{ id: number }> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  try {
    const [created] = await db.insert(role).values({ description: name, idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
    return { id: created.idRole }
  } catch (err) {
    throw new Error(`Failed to create role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function renameRole(roleId: number, roleName: string): Promise<void> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  if ((await getRoleType(roleId)) !== 'SERVICE') throw new Error('This role cannot be renamed')
  try {
    await db.update(role).set({ description: name, dateMod: new Date().toISOString() }).where(eq(role.idRole, roleId))
  } catch (err) {
    throw new Error(`Failed to rename role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be edited')

  const grantIds = deltas.filter(d => d.authorization).map(d => d.idItem)
  const revokeIds = deltas.filter(d => !d.authorization).map(d => d.idItem)

  // Atomic grant/revoke + date_mod stamp in one transaction via the schema.sql RPC (DEC-3).
  // drizzle-orm's `sql` tag has no `.array()` helper — pass each Postgres array literal as a
  // bound text parameter and cast it explicitly, same idiom as writeTags's `::jsonb` cast (Task 7)
  // and updateUserRoles's `::bigint[]` cast (Task 8).
  const grantIdsArray = `{${grantIds.join(',')}}`
  const revokeIdsArray = `{${revokeIds.join(',')}}`
  try {
    await db.execute(sql`select public.apply_role_permission_deltas(${roleId}, ${grantIdsArray}::bigint[], ${revokeIdsArray}::bigint[])`)
  } catch (err) {
    throw new Error(`Failed to update permissions: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function deleteRole(roleId: number): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be deleted')
  try {
    await db.delete(role).where(eq(role.idRole, roleId))
  } catch (err) {
    throw new Error(`Failed to delete role: ${err instanceof Error ? err.message : String(err)}`)
  }
}
