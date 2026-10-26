'use server'

import { eq } from 'drizzle-orm'
import { unstable_update } from '@/lib/auth'
import { getSession } from '@/lib/auth-session'
import { users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'
import { listAvailableTenants } from './host-tenants'
import { readRequestHost } from './request-host'
import type { TenantState } from './tenant-selection'

/**
 * La scelta e il cambio del tenant (specifica 2026-10-21, §3.1, MT4-DEC-4, MT4-DEC-5, MT4-DEC-6,
 * MT4-DEC-16): dalla pagina di scelta e dal selettore della barra laterale.
 *
 * Nessuna autorità nel tenant: chi sceglie non ne ha ancora uno, o lo sta lasciando. Serve solo una
 * persona riconosciuta con l'account attivo, e l'id richiesto vale solo se compare fra i tenant
 * disponibili sull'indirizzo della richiesta (MT4-DEC-7).
 *
 * Nessuna delle due azioni porta altrove: restituiscono lo stato a cui è arrivata la sessione e la
 * home la carica il browser da capo (components/tenancy/load-page.ts). Un `redirect` qui farebbe
 * disegnare la home a Next con una richiesta interna all'indirizzo del server (`Host: localhost`),
 * non a quello della richiesta: su un indirizzo dedicato il proxy ricalcolerebbe il tenant
 * sull'indirizzo principale.
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
 * ricontrolla da sé. Restituisce lo stato della sessione dopo l'aggiornamento; la pagina dopo la
 * carica il browser (TenantChooser, TenantSwitcher).
 */
export async function chooseTenant(tenantId: number): Promise<TenantState> {
  allowAnyAuthenticated()
  const userId = await signedInPerson()
  if (typeof tenantId !== 'number' || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error('tenant_not_available')
  }
  const available = await listAvailableTenants(userId, await readRequestHost())
  const chosen = available.find(tenant => tenant.tenantId === tenantId)
  if (!chosen) throw new Error('tenant_not_available')

  await withGlobal(tx => tx.update(users).set({ lastTenantId: chosen.tenantId }).where(eq(users.id, userId)))
  const session = await unstable_update({ user: { tenantId: chosen.tenantId } })
  return session?.user?.tenantState ?? 'none'
}

/**
 * Ricalcola il tenant della sessione, per chi è sulla pagina di scelta o sul messaggio "Non sei
 * configurato su questo indirizzo": chi è stato aggiunto a un tenant nel frattempo entra senza
 * rifare l'accesso. Non sceglie niente e non scrive l'ultimo tenant usato; il callback `jwt`
 * ricalcola solo un token in `choose` o `none`.
 *
 * Restituisce lo stato a cui è arrivata la sessione, come `chooseTenant`; la pagina dopo la carica
 * il browser (components/tenancy/TenantNotConfigured.tsx).
 */
export async function refreshTenant(): Promise<TenantState> {
  allowAnyAuthenticated()
  await signedInPerson()
  const session = await unstable_update({})
  return session?.user?.tenantState ?? 'none'
}
