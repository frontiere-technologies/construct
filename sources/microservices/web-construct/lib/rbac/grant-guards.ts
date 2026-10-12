import type { Actor } from './actor'
import { isPermissionCode } from './permission-catalog'
import { ROLE_ADMINISTRATOR } from './types'

/**
 * Non si concede ciò che non si possiede (DEC-6 della specifica 2026-09-01, esteso da DEC-29 del
 * piano 2026-10-12). Senza queste regole un permesso di gestione in mano a un ruolo limitato
 * equivale a tutti i permessi con un giro in più: `grant-role-permissions` si concede `manage-menu`,
 * `assign-user-roles` si assegna il ruolo Amministratore.
 *
 * Solo chi concede o assegna è vincolato; revocare non lo è, con un'eccezione: togliere il ruolo
 * Amministratore a qualcuno è riservato all'Amministratore, come darlo.
 */

export interface RoleGrants {
  idRole: number
  codes: string[]
  functionalityIds: number[]
}

export function assertCanGrantPermissions(actor: Actor, codes: string[]): void {
  if (actor.isAdmin) return
  const missing = codes.filter(code => !isPermissionCode(code) || !actor.permissions.has(code))
  if (missing.length) throw new Error(`Cannot grant permission(s) you do not hold: ${missing.join(', ')}`)
}

export function assertCanGrantFunctionalities(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  ids: number[],
): void {
  if (actor.isAdmin) return
  const missing = ids.filter(id => !actorFunctionalityIds.has(id))
  if (missing.length) throw new Error(`Cannot grant menu entry(ies) you cannot see: ${missing.join(', ')}`)
}

export function assertCanChangeRoles(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  touched: RoleGrants[],
): void {
  if (actor.isAdmin) return
  if (touched.some(r => r.idRole === ROLE_ADMINISTRATOR)) {
    throw new Error('Only an administrator can assign or remove the Administrator role')
  }
  for (const grants of touched) {
    assertCanGrantPermissions(actor, grants.codes)
    assertCanGrantFunctionalities(actor, actorFunctionalityIds, grants.functionalityIds)
  }
}

export function assertCanChangeStatus(actor: Actor, targetIsAdmin: boolean): void {
  if (!actor.isAdmin && targetIsAdmin) {
    throw new Error('Only an administrator can change the status of an administrator')
  }
}

export function symmetricDifference(a: number[], b: number[]): number[] {
  const left = new Set(a)
  const right = new Set(b)
  return [...a.filter(x => !right.has(x)), ...b.filter(x => !left.has(x))]
}
