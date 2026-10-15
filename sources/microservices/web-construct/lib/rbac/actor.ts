import { cache } from 'react'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { permission, rolePermission } from '@/lib/db/schema'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { selectUserAuthorization } from './auth-roles'
import { PERMISSION_CODES, isPermissionCode, type PermissionCode } from './permission-catalog'

/** Chi sta facendo la richiesta, letto dal database e mai dal token (DEC-4). */
export interface Actor {
  userId: string
  tenantId: TenantId
  roleIds: number[]
  isAdmin: boolean
  permissions: ReadonlySet<PermissionCode>
}

/**
 * L'unico posto dove vive l'eccezione dell'Amministratore (DEC-5): riceve tutti i codici del
 * catalogo, anche quelli che un rilascio ha appena aggiunto e che nessuno gli ha ancora concesso.
 * Un account disattivato non è un attore, qualunque cosa concedano i suoi ruoli.
 */
export function buildActor(
  userId: string,
  tenantId: TenantId,
  authorization: { accountActive: boolean; roleIds: number[]; isAdmin: boolean },
  grantedCodes: string[],
): Actor | null {
  if (!authorization.accountActive) return null
  const permissions = new Set<PermissionCode>(
    authorization.isAdmin ? PERMISSION_CODES : grantedCodes.filter(isPermissionCode),
  )
  return { userId, tenantId, roleIds: authorization.roleIds, isAdmin: authorization.isAdmin, permissions }
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
    const authorization = await selectUserAuthorization(tx, userId)
    if (!authorization.accountActive) return null
    let codes: string[] = []
    if (!authorization.isAdmin && authorization.roleIds.length) {
      const rows = await tx
        .selectDistinct({ code: permission.code })
        .from(rolePermission)
        .innerJoin(permission, eq(permission.idPermission, rolePermission.idPermission))
        .where(and(
          inArray(rolePermission.idRole, authorization.roleIds),
          isNull(permission.deprecatedAt),
          isNotNull(permission.code),
        ))
      codes = rows.flatMap(row => (row.code ? [row.code] : []))
    }
    return buildActor(userId, tenantId, authorization, codes)
  }))
