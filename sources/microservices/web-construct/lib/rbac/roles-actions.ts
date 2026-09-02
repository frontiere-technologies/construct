'use server'

import { eq, inArray, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { permission, role, roleType } from '@/lib/db/schema'
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

  // Spec 3.3 / HOLE-5: la concessione sta sulle foglie, una categoria non riceve mai una riga in
  // role_permission. Quell'invariante viveva solo in buildAuthMap/applyToggle
  // (lib/rbac/permission-tree.ts) — due funzioni pure lato client, senza alcun presidio server o
  // database: è esattamente la classe di errore che ha prodotto HOLE-5 (una regola affidata alla
  // buona educazione del chiamante, che regge finché tutti i chiamanti sono quelli che conosci).
  // La migrazione 0020 ha ripulito il residuo già scritto; qui si chiude il varco che lo scrive.
  //
  // Politica severa, non tollerante: un delta verso una categoria rifiuta l'INTERA chiamata,
  // non viene scartato in silenzio. Scartarlo in silenzio renderebbe l'interfaccia difficile da
  // usare male oggi, ma nasconderebbe di nuovo un chiamante difettoso di domani — lo stesso
  // silenzio che in applyToggle ha prodotto HOLE-5, spostato di un livello. Un chiamante che
  // genera un delta simile ha un difetto da far emergere subito, non da assorbire.
  if (deltas.length) {
    let targeted: { idPermission: number; kind: 'CATEGORY' | 'GRANT' }[]
    try {
      targeted = await db
        .select({ idPermission: permission.idPermission, kind: permission.kind })
        .from(permission)
        .where(inArray(permission.idPermission, deltas.map(d => d.idItem)))
    } catch (err) {
      throw new Error(`Failed to update permissions: ${err instanceof Error ? err.message : String(err)}`)
    }
    const categoryIds = targeted.filter(p => p.kind === 'CATEGORY').map(p => p.idPermission)
    if (categoryIds.length) {
      throw new Error(`Cannot grant or revoke category permission(s): ${categoryIds.join(', ')}`)
    }
  }

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
