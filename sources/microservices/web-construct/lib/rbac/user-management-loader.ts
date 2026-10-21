import { allInTransaction } from '@/lib/db/all-in-transaction'
import { withTenant } from '@/lib/db/tenant-db'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { hasPermission, type Actor } from './actor'
import { assignableRoleIds } from './grant-service'
import { selectAllRoles } from './roles-service'

/**
 * I dati della pagina Utenti in una transazione sola (specifica 2026-10-15, §2.4): l'elenco dei
 * ruoli, quelli che l'attore può assegnare (DEC-29, DEC-32) e il ruolo base del tenant, che il
 * client non conosce (MTF-DEC-5).
 */
export async function loadUserManagementPage(actor: Actor) {
  return withTenant(actor.tenantId, async tx => {
    // Due istruzioni senza parametri: postgres.js le mette in coda insieme sulla stessa connessione
    // (specifica 2026-10-15, §2.5). Ogni ramo è una sola istruzione.
    const [roles, system] = await allInTransaction([selectAllRoles(tx), getSystemRoleIds(tx)])
    const allRoles = roles.map(r => ({ id: r.id, name: r.description }))
    const canAssignRoles = hasPermission(actor, 'assign-user-roles')
    const assignable = canAssignRoles ? await assignableRoleIds(tx, actor, allRoles.map(r => r.id), system) : []
    return { allRoles, assignable, registeredRoleId: system.registered, canInvite: hasPermission(actor, 'invite-users') }
  })
}
