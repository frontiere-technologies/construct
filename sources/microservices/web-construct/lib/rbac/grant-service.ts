import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, roleFunctionality, rolePermission, userRole } from '@/lib/db/schema'
import type { Actor } from './actor'
import { canChangeRole, canGrantCode, canGrantFunctionality, type RoleGrants } from './grant-guards'
import type { GrantableItemIds } from './types'

/** I code delle righe GRANT indicate. Una categoria non ha code e non compare: la rifiuta
 *  `updateRolePermissions` per conto suo, con il proprio messaggio. Una riga GRANT senza code
 *  non è nel catalogo e nessuno la possiede: si rifiuta qui, altrimenti sparirebbe dal controllo
 *  e un non amministratore potrebbe concederla senza verifica. */
export async function permissionCodesByIds(ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await db
    .select({ idPermission: permission.idPermission, kind: permission.kind, code: permission.code })
    .from(permission)
    .where(inArray(permission.idPermission, ids))
  const uncoded = rows.filter(row => row.kind === 'GRANT' && !row.code).map(row => row.idPermission)
  if (uncoded.length) throw new Error(`Cannot grant permission(s) outside the catalog: ${uncoded.join(', ')}`)
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

/** Le concessioni di ciascun ruolo. Una riga GRANT senza code finisce in `uncataloguedIds`, non
 *  sparisce: per `assertCanChangeRoles` è una concessione che nessuno possiede, come per
 *  `permissionCodesByIds` quando la si vuole concedere. */
export async function grantsForRoles(roleIds: number[]): Promise<RoleGrants[]> {
  if (!roleIds.length) return []
  const [codes, functionalities] = await Promise.all([
    db.select({
      idRole: rolePermission.idRole, idPermission: permission.idPermission, kind: permission.kind, code: permission.code,
    })
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
    uncataloguedIds: codes
      .filter(row => row.idRole === idRole && row.kind === 'GRANT' && !row.code)
      .map(row => row.idPermission),
  }))
}

export async function currentRoleIds(userId: string): Promise<number[]> {
  const rows = await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
  return rows.map(row => row.idRole)
}

/**
 * Fra i ruoli indicati, quelli che l'attore può assegnare e togliere (DEC-29). Le regole sono
 * quelle di `assertCanChangeRoles`, lette da `grant-guards.ts`: la pagina Utenti non offre un
 * ruolo che `updateUserRoles` rifiuterebbe (I3 della revisione finale, DEC-32).
 */
export async function assignableRoleIds(actor: Actor, roleIds: number[]): Promise<number[]> {
  const [visible, grants] = await Promise.all([functionalityIdsForRoles(actor.roleIds), grantsForRoles(roleIds)])
  return grants.filter(g => canChangeRole(actor, visible, g)).map(g => g.idRole)
}

/**
 * Fra le voci indicate dei due alberi della pagina Ruoli, quelle che l'attore può concedere
 * (DEC-6, DEC-29): righe GRANT il cui codice possiede, voci di menu che vede. Una categoria non
 * si concede mai e non compare. Le regole sono quelle di `updateRolePermissions`, lette da
 * `grant-guards.ts`.
 */
export async function grantableItemIds(actor: Actor, candidates: GrantableItemIds): Promise<GrantableItemIds> {
  const [rows, visible] = await Promise.all([
    candidates.operationIds.length
      ? db.select({ idPermission: permission.idPermission, kind: permission.kind, code: permission.code })
        .from(permission)
        .where(inArray(permission.idPermission, candidates.operationIds))
      : Promise.resolve([]),
    functionalityIdsForRoles(actor.roleIds),
  ])
  return {
    operationIds: rows
      .filter(row => row.kind === 'GRANT' && canGrantCode(actor, row.code))
      .map(row => row.idPermission),
    functionalityIds: candidates.functionalityIds.filter(id => canGrantFunctionality(actor, visible, id)),
  }
}
