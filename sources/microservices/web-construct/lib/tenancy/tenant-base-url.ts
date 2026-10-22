import { and, eq } from 'drizzle-orm'
import { tenantHost } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import type { TenantId } from './tenant-id'

/** Il codice d'errore di quando manca l'indirizzo configurato: lo stesso di prima del pezzo 4. */
const SERVER_CONFIGURATION = 'server_configuration'

/**
 * L'indirizzo base dei link nelle email di un tenant (specifica 2026-10-21, §3.4, MT4-DEC-12):
 * `AUTH_URL` (o il vecchio `NEXTAUTH_URL`) con il solo nome dell'host sostituito dall'indirizzo
 * principale del tenant (`tenant_host.is_primary`); schema, porta e percorso restano quelli di
 * `AUTH_URL`. Senza un indirizzo principale (il predefinito, un tenant senza indirizzi) `AUTH_URL`
 * così com'è. L'intestazione `Host` della richiesta non entra mai qui: sceglie al più il tenant,
 * confrontata con il registro, e un `Host: evil.example` vale il predefinito. Senza `AUTH_URL`
 * lancia `server_configuration`, come prima.
 */
export async function tenantBaseUrl(tenantId: TenantId): Promise<string> {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL
  if (!configured) throw new Error(SERVER_CONFIGURATION)

  const [primary] = await withGlobal(tx => tx
    .select({ host: tenantHost.host })
    .from(tenantHost)
    .where(and(eq(tenantHost.idTenant, tenantId), eq(tenantHost.isPrimary, true)))
    .limit(1))
  if (!primary) return configured

  const url = new URL(configured)
  // Il registro salva l'indirizzo minuscolo e senza porta (0053): è un nome di host valido.
  url.hostname = primary.host
  return url.href.replace(/\/$/, '')
}
