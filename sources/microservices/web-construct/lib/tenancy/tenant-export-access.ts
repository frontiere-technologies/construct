import { getSession } from '@/lib/auth-session'
import { evaluateAuthorization, isActiveAccount } from '@/lib/auth-policy'
import { withTenant } from '@/lib/db/tenant-db'
import { buildActor, type Actor } from '@/lib/rbac/actor'
import { selectAuthorizationSnapshot } from '@/lib/rbac/auth-roles'
import { readRequestHost } from './request-host'
import { isSupportSession, tenantFromSession } from './request-tenant'
import { selectSupportAccess, supportConditionsHold } from './support-consent'
import type { TenantId } from './tenant-id'
import { isMultiTenantEnabled } from './tenancy-mode'

/**
 * Ogni controllo apre una nuova transazione: mai cache React, mai la fotografia stabile dei dati
 * preparati per l'esportazione. Stato, account, ruolo o consenso possono cambiare prima della consegna.
 */
async function readTenantExporter(tenantId: TenantId, userId: string, inSupport: boolean): Promise<Actor> {
  const host = await readRequestHost()
  return withTenant(tenantId, async tx => {
    if (inSupport) {
      if (!isMultiTenantEnabled()) throw new Error('Unauthorized')
      const access = await selectSupportAccess(tx, userId, host, { entry: true })
      if (!supportConditionsHold(access) || access.isTemplate || !access.entryOpen || !access.exportAllowed) throw new Error('Unauthorized')
      const actor = buildActor(userId, tenantId, {
        accountActive: true, roleIds: [access.tenantAdminRoleId], isAdmin: true, isPlatformAdmin: true,
      }, [], access.enabledFeatures)
      if (!actor) throw new Error('Unauthorized')
      return { ...actor, support: true, canManageSupportConsent: false }
    }

    // La lettura con host esclude anche modello, tenant sospeso/archiviato e indirizzo sbagliato;
    // in single ammette solo il vero amministratore del tenant default.
    const snapshot = await selectAuthorizationSnapshot(tx, userId, { permissionCodes: true, host })
    const authorization = evaluateAuthorization(snapshot.userExists ? snapshot.status : null,
      snapshot.membershipStatus, snapshot.roleIds, snapshot.system.tenantAdmin)
    if (!snapshot.tenantEligible || !authorization.isAdmin) throw new Error('Unauthorized')
    const actor = buildActor(userId, tenantId, {
      ...authorization, isPlatformAdmin: snapshot.isPlatformAdmin && isActiveAccount(snapshot.status),
    }, snapshot.permissionCodes, snapshot.enabledFeatures)
    if (!actor) throw new Error('Unauthorized')
    return actor
  }, { isolationLevel: 'read committed', accessMode: 'read only' })
}

/** Amministratore del tenant, oppure piattaforma in assistenza con estensione export esplicita. */
export async function requireTenantExporter(): Promise<Actor> {
  const session = await getSession()
  const userId = session?.user?.id
  const tenantId = session ? tenantFromSession(session) : null
  if (!session || !userId || tenantId === null) throw new Error('Unauthorized')
  return readTenantExporter(tenantId, userId, isSupportSession(session))
}

/** Rivalida soltanto l'identità dell'attore preparato, senza fidarsi dei suoi flag o ruoli salvati. */
export async function assertTenantExportStillAllowed(actor: Actor): Promise<void> {
  await readTenantExporter(actor.tenantId, actor.userId, actor.support === true)
}
