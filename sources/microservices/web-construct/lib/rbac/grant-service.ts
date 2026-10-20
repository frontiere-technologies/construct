import { and, eq, inArray, isNull } from 'drizzle-orm'
import { allInTransaction } from '@/lib/db/all-in-transaction'
import type { TenantTx } from '@/lib/db/tenant-db'
import { permission, roleFunctionality, rolePermission, userRole } from '@/lib/db/schema'
import { getSystemRoleIds, type SystemRoleIds } from '@/lib/tenancy/system-roles'
import type { Actor } from './actor'
import { canChangeRole, canGrantCode, canGrantFunctionality, type RoleGrants } from './grant-guards'
import type { GrantableItemIds } from './types'

/** I code delle righe GRANT indicate. Una categoria non ha code e non compare: la rifiuta
 *  `updateRolePermissions` per conto suo, con il proprio messaggio. Una riga GRANT senza code
 *  non è nel catalogo e nessuno la possiede: si rifiuta qui, altrimenti sparirebbe dal controllo
 *  e un non amministratore potrebbe concederla senza verifica. */
export async function permissionCodesByIds(tx: TenantTx, ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await tx
    .select({ idPermission: permission.idPermission, kind: permission.kind, code: permission.code })
    .from(permission)
    .where(inArray(permission.idPermission, ids))
  const uncoded = rows.filter(row => row.kind === 'GRANT' && !row.code).map(row => row.idPermission)
  if (uncoded.length) throw new Error(`Cannot grant permission(s) outside the catalog: ${uncoded.join(', ')}`)
  return rows.flatMap(row => (row.code ? [row.code] : []))
}

export async function functionalityIdsForRoles(tx: TenantTx, roleIds: number[]): Promise<Set<number>> {
  if (!roleIds.length) return new Set()
  const rows = await tx
    .select({ idMenuEntry: roleFunctionality.idMenuEntry })
    .from(roleFunctionality)
    .where(inArray(roleFunctionality.idRole, roleIds))
  return new Set(rows.map(row => row.idMenuEntry))
}

/** Le concessioni di ciascun ruolo. Una riga GRANT senza code finisce in `uncataloguedIds`, non
 *  sparisce: per `assertCanChangeRoles` è una concessione che nessuno possiede, come per
 *  `permissionCodesByIds` quando la si vuole concedere. */
export async function grantsForRoles(tx: TenantTx, roleIds: number[]): Promise<RoleGrants[]> {
  if (!roleIds.length) return []
  // Lanciate insieme, ma con parametri: con prepare: false postgres.js non le sovrappone, la seconda
  // aspetta la fine della prima (2 viaggi ciascuna, specifica 2026-10-15, §2.5). Ogni ramo è una
  // sola istruzione.
  const [codes, functionalities] = await allInTransaction([
    tx.select({
      idRole: rolePermission.idRole, idPermission: permission.idPermission, kind: permission.kind, code: permission.code,
    })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
      .where(and(inArray(rolePermission.idRole, roleIds), isNull(permission.deprecatedAt))),
    tx.select({ idRole: roleFunctionality.idRole, idMenuEntry: roleFunctionality.idMenuEntry })
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

export async function currentRoleIds(tx: TenantTx, userId: string): Promise<number[]> {
  const rows = await tx.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
  return rows.map(row => row.idRole)
}

/**
 * Fra i ruoli indicati, quelli che l'attore può assegnare e togliere (DEC-29). Le regole sono
 * quelle di `assertCanChangeRoles`, lette da `grant-guards.ts`: la pagina Utenti non offre un
 * ruolo che `updateUserRoles` rifiuterebbe (I3 della revisione finale, DEC-32).
 * Chi ha già letto i ruoli di sistema nella stessa transazione li passa in `system`, per non
 * rileggerli: `cache()` di React non ricorda fuori da un rendering, e un'istruzione in più è un
 * viaggio in più.
 */
export async function assignableRoleIds(tx: TenantTx, actor: Actor, roleIds: number[], system?: SystemRoleIds): Promise<number[]> {
  // Le prime due letture hanno parametri e restano in serie con prepare: false (specifica
  // 2026-10-15, §2.5); i ruoli di sistema, se non sono già dati, sono senza parametri. Ogni ramo
  // deve essere una sola istruzione, oppure attendere tutto ciò che avvia.
  const [visible, grants, { tenantAdmin }] = await allInTransaction([
    functionalityIdsForRoles(tx, actor.roleIds),
    grantsForRoles(tx, roleIds),
    system ?? getSystemRoleIds(tx),
  ])
  return grants.filter(g => canChangeRole(actor, visible, g, tenantAdmin)).map(g => g.idRole)
}

/**
 * Fra le voci indicate dei due alberi della pagina Ruoli, quelle che l'attore può concedere
 * (DEC-6, DEC-29): righe GRANT il cui codice possiede, voci di menu che vede. Una categoria non
 * si concede mai e non compare. Le regole sono quelle di `updateRolePermissions`, lette da
 * `grant-guards.ts`.
 */
export async function grantableItemIds(tx: TenantTx, actor: Actor, candidates: GrantableItemIds): Promise<GrantableItemIds> {
  const rows = candidates.operationIds.length
    ? await tx.select({ idPermission: permission.idPermission, kind: permission.kind, code: permission.code })
      .from(permission)
      .where(inArray(permission.idPermission, candidates.operationIds))
    : []
  const visible = await functionalityIdsForRoles(tx, actor.roleIds)
  return {
    operationIds: rows
      .filter(row => row.kind === 'GRANT' && canGrantCode(actor, row.code))
      .map(row => row.idPermission),
    functionalityIds: candidates.functionalityIds.filter(id => canGrantFunctionality(actor, visible, id)),
  }
}
