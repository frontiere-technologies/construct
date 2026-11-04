import { featureForPermission } from '@/lib/tenancy/feature-catalog'
import type { TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { canUseMenuEntry, type MenuFeatureBinding } from './menu-feature-binding'
import type { Actor } from './actor'
import { isPermissionCode } from './permission-catalog'

/**
 * Non si concede ciò che non si possiede (DEC-6 della specifica 2026-09-01, esteso da DEC-29 del
 * piano 2026-10-12). Senza queste regole un permesso di gestione in mano a un ruolo limitato
 * equivale a tutti i permessi con un giro in più: `grant-role-permissions` si concede `manage-menu`,
 * `assign-user-roles` si assegna il ruolo Amministratore.
 *
 * Solo chi concede o assegna è vincolato; revocare non lo è, con un'eccezione: togliere il ruolo
 * Amministratore a qualcuno è riservato all'Amministratore, come darlo.
 */

export interface TenantGrantContext {
  policy: TenantPolicySnapshot
  menuBindings: ReadonlyMap<number, MenuFeatureBinding>
}

export interface RoleGrants {
  idRole: number
  codes: string[]
  functionalityIds: number[]
  /** Righe GRANT senza codice: fuori dal catalogo, nessun non amministratore le possiede. */
  uncataloguedIds: number[]
}

/**
 * L'attore può concedere questo codice? `null` è una riga GRANT senza codice: fuori dal catalogo,
 * non si concede a runtime. Le assert sotto e le pagine che decidono che cosa offrire
 * (DEC-32) leggono la stessa regola da qui.
 */
export function canGrantCode(actor: Actor, code: string | null): boolean {
  if (code === null || !isPermissionCode(code)) return false
  const feature = featureForPermission(code)
  if (feature === null || !actor.features.has(feature)) return false
  if (actor.isAdmin) return true
  return actor.permissions.has(code)
}

/** L'attore può concedere questa voce di menu? Solo se la vede, cioè se è di uno dei suoi ruoli. */
export function canGrantFunctionality(actor: Actor, actorFunctionalityIds: ReadonlySet<number>, id: number, context: TenantGrantContext): boolean {
  const binding = context.menuBindings.get(id)
  return binding !== undefined && binding.featureKey !== null && canUseMenuEntry(context.policy, binding) && (actor.isAdmin || actorFunctionalityIds.has(id))
}

export function assertCanGrantPermissions(actor: Actor, codes: string[]): void {
  const missing = codes.filter(code => !canGrantCode(actor, code))
  if (missing.length) throw new Error(`Cannot grant permission(s) you do not hold: ${missing.join(', ')}`)
}

export function assertCanGrantFunctionalities(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  ids: number[],
  context: TenantGrantContext,
): void {
  const missing = ids.filter(id => !canGrantFunctionality(actor, actorFunctionalityIds, id, context))
  if (missing.length) throw new Error(`Cannot grant menu entry(ies) you cannot see: ${missing.join(', ')}`)
}

/** Il motivo per cui l'attore non può assegnare né togliere questi ruoli, o `null` se può. */
function roleChangeRefusal(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  touched: RoleGrants[],
  tenantAdminId: number,
  context: TenantGrantContext,
): string | null {
  const missingBindings = touched.flatMap(grants => grants.functionalityIds.filter(id => !context.menuBindings.has(id)))
  if (missingBindings.length) return `Cannot grant menu entry(ies) without a binding: ${missingBindings.join(', ')}`
  if (actor.isAdmin) return null
  if (touched.some(r => r.idRole === tenantAdminId)) {
    return 'Only an administrator can assign or remove the Administrator role'
  }
  for (const grants of touched) {
    // Come `permissionCodesByIds` per chi concede: una concessione fuori catalogo non si possiede,
    // quindi il ruolo che la porta non si assegna né si toglie.
    if (grants.uncataloguedIds.length) {
      return `Cannot assign role ${grants.idRole}: it holds permission(s) outside the catalog: ${grants.uncataloguedIds.join(', ')}`
    }
    const codes = grants.codes.filter(code => {
      const feature = isPermissionCode(code) ? featureForPermission(code) : null
      return feature === null || (context.policy.enabledFeatures.includes(feature) && !canGrantCode(actor, code))
    })
    if (codes.length) return `Cannot grant permission(s) you do not hold: ${codes.join(', ')}`
    const ids = grants.functionalityIds.filter(id => {
      const binding = context.menuBindings.get(id)
      return binding === undefined || (canUseMenuEntry(context.policy, binding) && !canGrantFunctionality(actor, actorFunctionalityIds, id, context))
    })
    if (ids.length) return `Cannot grant menu entry(ies) you cannot see: ${ids.join(', ')}`
  }
  return null
}

export function assertCanChangeRoles(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  touched: RoleGrants[],
  tenantAdminId: number,
  context: TenantGrantContext,
): void {
  const refusal = roleChangeRefusal(actor, actorFunctionalityIds, touched, tenantAdminId, context)
  if (refusal) throw new Error(refusal)
}

/** Lo stesso giudizio di `assertCanChangeRoles` su un ruolo solo, per la pagina che deve sapere
 *  in anticipo quali ruoli offrire. */
export function canChangeRole(
  actor: Actor,
  actorFunctionalityIds: ReadonlySet<number>,
  grants: RoleGrants,
  tenantAdminId: number,
  context: TenantGrantContext,
): boolean {
  return roleChangeRefusal(actor, actorFunctionalityIds, [grants], tenantAdminId, context) === null
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
