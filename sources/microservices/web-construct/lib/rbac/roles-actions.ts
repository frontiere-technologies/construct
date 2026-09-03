'use server'

import { eq, inArray, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { permission, menuEntry, role, roleType } from '@/lib/db/schema'
import type { RolePermissionDeltas, RoleType as RoleTypeStr } from './types'

/** `{id_role, ids}` → il letterale di array che Postgres si aspetta. `drizzle-orm`'s `sql`
 *  non ha un helper `.array()`: si passa il letterale come parametro di testo e si casta,
 *  lo stesso idioma di `writeTags` (`::jsonb`) e `updateUserRoles` (`::bigint[]`). */
const arrayLiteral = (ids: number[]) => `{${ids.join(',')}}`

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

export async function updateRolePermissions(roleId: number, deltas: RolePermissionDeltas): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be edited')

  // Una cartella non riceve mai una riga di concessione (DEC-20). L'invariante viveva solo
  // nelle funzioni pure lato client, ed è la classe di errore che ha prodotto HOLE-5: una
  // regola affidata alla buona educazione del chiamante, che regge finché tutti i chiamanti
  // sono quelli che conosci. Una server action è un endpoint HTTP: la sua sicurezza non può
  // dipendere da quale modulo la chiama.
  //
  // Politica severa e non tollerante, su ENTRAMBI gli alberi: un delta verso una cartella
  // rifiuta l'INTERA chiamata invece di essere scartato in silenzio. Scartarlo nasconderebbe
  // un chiamante difettoso di domani — lo stesso silenzio che in applyToggle ha prodotto
  // HOLE-5, spostato di un livello.
  //
  // Il criterio è dedotto dai DATI SALVATI, non dall'input: `kind` sulla riga di permission,
  // `id_functionality_type` nullo sulla voce di menu. Nessuna forma dell'input può spacciare
  // una cartella per una foglia.
  await db.transaction(async tx => {
    if (deltas.operations.length) {
      const targeted = await tx
        .select({ idPermission: permission.idPermission, kind: permission.kind })
        .from(permission)
        .where(inArray(permission.idPermission, deltas.operations.map(d => d.idItem)))
      const categoryIds = targeted.filter(p => p.kind === 'CATEGORY').map(p => p.idPermission)
      if (categoryIds.length) {
        throw new Error(`Cannot grant or revoke category permission(s): ${categoryIds.join(', ')}`)
      }
    }

    if (deltas.functionalities.length) {
      const targeted = await tx
        .select({ idMenuEntry: menuEntry.idMenuEntry, idFunctionalityType: menuEntry.idFunctionalityType })
        .from(menuEntry)
        .where(inArray(menuEntry.idMenuEntry, deltas.functionalities.map(d => d.idItem)))
      const containerIds = targeted.filter(e => e.idFunctionalityType === null).map(e => e.idMenuEntry)
      if (containerIds.length) {
        throw new Error(`Cannot grant or revoke container menu entry(ies): ${containerIds.join(', ')}`)
      }
    }

    // Le due funzioni del database, nella stessa transazione: un rifiuto su un albero non
    // deve lasciare scritto l'altro.
    if (deltas.operations.length) {
      await tx.execute(sql`select public.apply_role_permission_deltas(
        ${roleId},
        ${arrayLiteral(deltas.operations.filter(d => d.authorization).map(d => d.idItem))}::bigint[],
        ${arrayLiteral(deltas.operations.filter(d => !d.authorization).map(d => d.idItem))}::bigint[]
      )`)
    }
    if (deltas.functionalities.length) {
      await tx.execute(sql`select public.apply_role_functionality_deltas(
        ${roleId},
        ${arrayLiteral(deltas.functionalities.filter(d => d.authorization).map(d => d.idItem))}::bigint[],
        ${arrayLiteral(deltas.functionalities.filter(d => !d.authorization).map(d => d.idItem))}::bigint[]
      )`)
    }
  })
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
