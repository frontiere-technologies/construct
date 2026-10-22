'use server'

import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { unstable_update } from '@/lib/auth'
import { getSession } from '@/lib/auth-session'
import { users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'
import { listAvailableTenants } from './host-tenants'
import { readRequestHost } from './request-host'

/**
 * La scelta e il cambio del tenant (specifica 2026-10-21, §3.1, MT4-DEC-4, MT4-DEC-5, MT4-DEC-6,
 * MT4-DEC-16): dalla pagina di scelta e dal selettore della barra laterale.
 *
 * Nessuna autorità nel tenant: chi sceglie non ne ha ancora uno, o lo sta lasciando. Serve solo una
 * persona riconosciuta con l'account attivo, e l'id richiesto vale solo se compare fra i tenant
 * disponibili sull'indirizzo della richiesta (MT4-DEC-7). Dopo la scelta si va alla home con
 * `redirect` di Next: `unstable_update` non passa dagli handler che tengono i rinvii di Auth.js
 * sull'indirizzo della richiesta (lib/auth-host-redirect.ts).
 */

/** La persona della sessione, se riconosciuta e con l'account attivo; altrimenti rifiuto. */
async function signedInPerson(): Promise<string> {
  const session = await getSession()
  const userId = session?.user?.id
  if (!userId || !session.user.accountActive) throw new Error('Unauthorized')
  return userId
}

/**
 * Entra nel tenant scelto. L'id arriva dal client: si accetta solo se è fra i tenant disponibili
 * sull'indirizzo, altrimenti `tenant_not_available` e niente cambia. Una scelta esplicita aggiorna
 * l'ultimo tenant usato (MT4-DEC-16); il token si aggiorna con il solo id, e il callback `jwt` lo
 * ricontrolla da sé.
 */
export async function chooseTenant(tenantId: number): Promise<void> {
  allowAnyAuthenticated()
  const userId = await signedInPerson()
  if (typeof tenantId !== 'number' || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error('tenant_not_available')
  }
  const available = await listAvailableTenants(userId, await readRequestHost())
  const chosen = available.find(tenant => tenant.tenantId === tenantId)
  if (!chosen) throw new Error('tenant_not_available')

  await withGlobal(tx => tx.update(users).set({ lastTenantId: chosen.tenantId }).where(eq(users.id, userId)))
  await unstable_update({ user: { tenantId: chosen.tenantId } })
  redirect('/')
}

/**
 * Ricalcola il tenant della sessione, per chi è sulla pagina di scelta o sul messaggio "Non sei
 * configurato su questo indirizzo": chi è stato aggiunto a un tenant nel frattempo entra senza
 * rifare l'accesso. Non sceglie niente e non scrive l'ultimo tenant usato; il callback `jwt`
 * ricalcola solo un token in `choose` o `none`.
 */
export async function refreshTenant(): Promise<void> {
  allowAnyAuthenticated()
  await signedInPerson()
  await unstable_update({})
  redirect('/')
}
