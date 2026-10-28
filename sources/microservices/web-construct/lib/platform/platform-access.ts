import type { Session } from 'next-auth'
import { getI18n } from '@/lib/i18n/server'
import { resolvePlatformAdmin } from '@/lib/rbac/platform-admin'
import { listAvailableTenants } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import type { MenuItem } from '@/types/menu'
import { platformEntryItem } from './platform-menu'

/**
 * La voce "Piattaforma" della barra di un tenant (specifica 2026-10-26, MT5-DEC-3): c'è solo se la
 * persona è amministratore di piattaforma **e** la richiesta arriva sull'indirizzo principale. Lo
 * decide il server dal database (`resolvePlatformAdmin`, che rilegge l'attributo e rifiuta un
 * indirizzo dedicato), non dall'indizio del token: l'indizio serve solo a non leggere il database
 * per chi non lo ha, cioè quasi tutti, che vedono l'app com'era (MT5-OK-5). Un token vecchio che
 * ancora lo afferma ma un attributo tolto nel frattempo non mostra la voce.
 */
export async function platformMenuEntry(session: Session | null): Promise<MenuItem | null> {
  const userId = session?.user?.id
  if (!userId || session?.user?.isPlatformAdmin !== true) return null
  // In assistenza la console è chiusa: niente voce, e nessuna lettura per deciderlo.
  if (session.user.tenantState === 'support') return null
  const admin = await resolvePlatformAdmin(userId)
  if (!admin) return null
  const { t } = await getI18n()
  return platformEntryItem(t)
}

/**
 * Vero se la persona è membro attivo di un tenant su questo indirizzo: la console le offre il
 * collegamento per tornarci. Chi non ne ha (arriva in console perché non è in nessun tenant) non
 * ne vede.
 */
export async function belongsToTenantOnThisAddress(userId: string): Promise<boolean> {
  return (await listAvailableTenants(userId, await readRequestHost())).length > 0
}
