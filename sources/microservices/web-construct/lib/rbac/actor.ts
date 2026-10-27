import { cache } from 'react'
import { withTenant } from '@/lib/db/tenant-db'
import { evaluateAuthorization, isActiveAccount } from '@/lib/auth-policy'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { selectSupportAccess, supportConditionsHold } from '@/lib/tenancy/support-consent'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { selectAuthorizationSnapshot } from './auth-roles'
import { PERMISSION_CODES, isPermissionCode, type PermissionCode } from './permission-catalog'

/** Chi sta facendo la richiesta, letto dal database e mai dal token (DEC-4). */
export interface Actor {
  userId: string
  tenantId: TenantId
  roleIds: number[]
  isAdmin: boolean
  /** Attributo dell'account (MT5-DEC-1), letto con il resto dell'autorizzazione: non è un permesso del tenant. */
  isPlatformAdmin: boolean
  permissions: ReadonlySet<PermissionCode>
  /**
   * L'amministratore di piattaforma in assistenza nel tenant (pezzo 5a, MT5-DEC-12): ha i permessi
   * di un amministratore del tenant, ma nel registro agisce come piattaforma (`auditActorOf`) e non
   * tocca il permesso di assistenza. Assente per una persona del tenant: lo mette solo
   * `resolveSupportActor`, mai la forma dell'oggetto.
   */
  support?: true
}

/**
 * I permessi che scrivono i cataloghi globali di lingue e traduzioni (pezzo 2, MT2-DEC-11): una
 * scrittura cambia le righe di tutti i tenant. Finché il pezzo 5 non porta il ruolo della
 * piattaforma valgono solo per gli attori del tenant predefinito (specifica 2026-10-21, §5.3); in
 * ogni altro tenant mancano, quindi azioni, pagine e pulsanti rispondono come a chi non li ha.
 */
export const GLOBAL_CATALOG_WRITE_CODES: readonly PermissionCode[] = [
  'manage-languages', 'edit-translations', 'manage-translation-keys',
]

/**
 * L'unico posto dove vive l'eccezione dell'Amministratore (DEC-5): riceve tutti i codici del
 * catalogo, anche quelli che un rilascio ha appena aggiunto e che nessuno gli ha ancora concesso.
 * Un account disattivato non è un attore, qualunque cosa concedano i suoi ruoli. Fuori dal tenant
 * predefinito nessuno, Amministratore compreso, riceve `GLOBAL_CATALOG_WRITE_CODES`.
 */
export function buildActor(
  userId: string,
  tenantId: TenantId,
  authorization: { accountActive: boolean; roleIds: number[]; isAdmin: boolean; isPlatformAdmin: boolean },
  grantedCodes: string[],
  scope: { defaultTenant: boolean },
): Actor | null {
  if (!authorization.accountActive) return null
  const codes = authorization.isAdmin ? PERMISSION_CODES : grantedCodes.filter(isPermissionCode)
  const permissions = new Set<PermissionCode>(
    scope.defaultTenant ? codes : codes.filter(code => !GLOBAL_CATALOG_WRITE_CODES.includes(code)),
  )
  return {
    userId,
    tenantId,
    roleIds: authorization.roleIds,
    isAdmin: authorization.isAdmin,
    isPlatformAdmin: authorization.isPlatformAdmin,
    permissions,
  }
}

export function hasPermission(actor: Actor | null, code: PermissionCode): boolean {
  return actor !== null && actor.permissions.has(code)
}

/**
 * Una lettura per richiesta, deduplicata da `cache()` di React (DEC-11): una pagina che chiede il
 * proprio permesso e poi calcola i flag dei pulsanti interroga il database una volta sola. Niente
 * cache fra richieste, così una revoca vale dalla richiesta successiva.
 *
 * Un permesso deprecato non conta anche se la concessione esiste ancora.
 */
export const resolveActor = cache(async (tenantId: TenantId, userId: string): Promise<Actor | null> =>
  withTenant(tenantId, async tx => {
    // Stato, ruoli e codici dei permessi in un'istruzione sola (specifica 2026-10-15, §2.2).
    const snapshot = await selectAuthorizationSnapshot(tx, userId, { permissionCodes: true })
    const authorization = {
      ...evaluateAuthorization(
        snapshot.userExists ? snapshot.status : null,
        snapshot.userExists ? snapshot.membershipStatus : null,
        snapshot.userExists ? snapshot.roleIds : [],
        snapshot.system.tenantAdmin,
      ),
      isPlatformAdmin: snapshot.isPlatformAdmin && isActiveAccount(snapshot.status),
    }
    return buildActor(userId, tenantId, authorization, snapshot.permissionCodes, { defaultTenant: snapshot.tenantIsDefault })
  }))

/**
 * L'attore dell'amministratore di piattaforma in assistenza (pezzo 5a, §3.2, MT5-DEC-12): non è
 * membro del tenant, quindi `resolveActor` non lo riconosce. Ha i permessi del ruolo TENANT_ADMIN
 * del tenant, cioè quelli di un amministratore (DEC-5), con la stessa regola dei cataloghi globali;
 * la gestione del permesso di assistenza la rifiutano le sue azioni (`support`).
 *
 * Non si fida del token: rilegge nella stessa istruzione tutto ciò che la rivalidazione controlla
 * (permesso valido o modello, tenant attivo, attributo e account, indirizzo principale, voce
 * d'ingresso aperta). Una lettura per richiesta, come `resolveActor`.
 */
export const resolveSupportActor = cache(async (tenantId: TenantId, userId: string): Promise<Actor | null> => {
  const host = await readRequestHost()
  const access = await withTenant(tenantId, tx => selectSupportAccess(tx, userId, host, { entry: true }))
  if (!supportConditionsHold(access) || !access.entryOpen) return null
  const actor = buildActor(
    userId,
    tenantId,
    { accountActive: true, roleIds: [access.tenantAdminRoleId], isAdmin: true, isPlatformAdmin: true },
    [],
    { defaultTenant: access.isDefault },
  )
  return actor && { ...actor, support: true }
})
