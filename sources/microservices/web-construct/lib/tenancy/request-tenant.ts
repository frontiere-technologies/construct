import { cache } from 'react'
import type { Session } from 'next-auth'
import { getSession } from '@/lib/auth-session'
import { resolveHostTenant } from './host-tenants'
import { readRequestHost } from './request-host'
import { toTenantId, type TenantId } from './tenant-id'

/**
 * Il tenant di una sessione già letta: quello del token, rivalidato dal callback `jwt` nella stessa
 * `auth()` (specifica 2026-10-21, §3.1, MT4-DEC-7). In assistenza (pezzo 5a, §3.2) è il tenant
 * assistito, rivalidato allo stesso modo. `null` se la persona non ha ancora un tenant
 * (stato `choose` o `none`) o se l'account non è attivo. Chi ha già la sessione la passa qui invece
 * di chiamare `resolveRequestTenant`: fuori dal rendering `getSession` non memorizza, e una seconda
 * `auth()` rifarebbe la lettura dell'autorizzazione.
 */
export function tenantFromSession(session: Session): TenantId | null {
  const user = session.user
  if ((user?.tenantState !== 'ready' && user?.tenantState !== 'support') || typeof user.tenantId !== 'number') return null
  return toTenantId(user.tenantId)
}

/** La sessione è dell'amministratore di piattaforma in assistenza (pezzo 5a, §3.2): l'attore si calcola da `resolveSupportActor`. */
export function isSupportSession(session: Session): boolean {
  return session.user?.tenantState === 'support'
}

/**
 * Il tenant della richiesta corrente (§3.1, MT4-DEC-11): con una sessione, il tenant del token;
 * senza sessione, il tenant dell'indirizzo (pagine prima dell'accesso). Una sessione senza tenant
 * scelto (`choose`, `none`) non ha un tenant: errore `tenant_not_selected`. Le pagine protette non
 * ci arrivano (il proxy le manda alla scelta o al messaggio, Task 5) e le guardie dei permessi
 * rispondono prima con un rifiuto (`currentActor`). Il tenant non viene mai dal client.
 */
export const resolveRequestTenant = cache(async (): Promise<TenantId> => {
  const session = await getSession()
  if (!session) return resolveHostTenant(await readRequestHost())
  const tenantId = tenantFromSession(session)
  if (tenantId === null) throw new Error('tenant_not_selected')
  return tenantId
})

/**
 * Il tenant di cui la pagina prende l'aspetto (tema): quello della sessione se è scelto, altrimenti
 * quello dell'indirizzo, come prima dell'accesso. Serve al layout radice, che si disegna anche per la
 * pagina di scelta e per il messaggio "non configurato": lì non c'è un tenant e non è un errore.
 */
export const resolveRequestOrHostTenant = cache(async (): Promise<TenantId> => {
  const session = await getSession()
  const tenantId = session ? tenantFromSession(session) : null
  return tenantId ?? resolveHostTenant(await readRequestHost())
})
