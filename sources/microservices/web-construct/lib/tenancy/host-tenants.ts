import { sql } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { normalizeHost } from './request-host'
import { DEFAULT_TENANT_SLUG, toTenantId, type TenantId } from './tenant-id'

/** Un tenant che la persona può usare sull'indirizzo della richiesta (specifica 2026-10-21, §2.4). */
export type AvailableTenant = { tenantId: TenantId; name: string; isAdmin: boolean }

/**
 * I tenant che rispondono sull'indirizzo e dove la persona ha un'appartenenza attiva, con l'account
 * attivo a livello globale; ordinati per nome (MT4-DEC-2). `host` nullo, sconosciuto o non valido
 * è l'indirizzo principale. Le appartenenze sono tabelle di tenant: le legge la funzione SQL, che
 * visita i tenant uno per uno e rimette `app.tenant_id` com'era (0054). Un solo viaggio, ma la
 * funzione scorre i tenant dell'indirizzo: si chiama all'accesso, al cambio e quando la
 * rivalidazione fallisce, mai a ogni richiesta. L'ordine è scritto qui e non affidato all'ordine
 * in cui la funzione restituisce le righe.
 */
export async function listAvailableTenants(userId: string, host: string | null): Promise<AvailableTenant[]> {
  const rows = await withGlobal(tx => tx.execute<{ id_tenant: string; name: string; is_admin: boolean }>(sql`
    select a.id_tenant::text as id_tenant, a.name, a.is_admin
    from public.available_tenants(${userId}::uuid, ${normalizeHost(host)}::text) a
    order by a.name, a.id_tenant`))
  return rows.map(row => ({ tenantId: toTenantId(Number(row.id_tenant)), name: row.name, isAdmin: row.is_admin }))
}

/**
 * Il tenant dell'indirizzo prima dell'accesso (MT4-DEC-1, MT4-DEC-11): quello a cui l'indirizzo è
 * dedicato nel registro, altrimenti il predefinito. Non guarda lo stato del tenant: decide il tema
 * e le pagine pubbliche, e chi entra passa comunque da `listAvailableTenants`.
 */
export async function resolveHostTenant(host: string | null): Promise<TenantId> {
  const [row] = await withGlobal(tx => tx.execute<{ id: string | null }>(sql`
    select coalesce(
      (select h.id_tenant from public.tenant_host h where h.host = ${normalizeHost(host)}::text),
      (select t.id from public.tenant t where t.slug = ${DEFAULT_TENANT_SLUG})
    )::text as id`))
  if (!row?.id) throw new Error('default tenant missing')
  return toTenantId(Number(row.id))
}

/**
 * Vero se la persona ha un'appartenenza disattivata in almeno un tenant dell'indirizzo (MT4-DEC-15):
 * con nessun tenant disponibile lì, l'accesso si rifiuta come per l'account disattivato. Come
 * `listAvailableTenants` scorre i tenant dell'indirizzo: solo all'accesso.
 */
export async function hasDeactivatedMembershipOnHost(userId: string, host: string | null): Promise<boolean> {
  const [row] = await withGlobal(tx => tx.execute<{ deactivated: boolean }>(sql`
    select public.has_deactivated_membership_on_host(${userId}::uuid, ${normalizeHost(host)}::text) as deactivated`))
  return row?.deactivated === true
}

/**
 * Vero se l'indirizzo è nel registro, cioè dedicato a un tenant (MT4-DEC-14): lì si entra con email
 * e password, e l'accesso con Google e gli altri OIDC resta sull'indirizzo principale finché il
 * pezzo 6 non porta un accesso unico per tutti i domini. Nullo, sconosciuto o non valido è
 * l'indirizzo principale.
 */
export async function isDedicatedHost(host: string | null): Promise<boolean> {
  const normalized = normalizeHost(host)
  if (normalized === null) return false
  const [row] = await withGlobal(tx => tx.execute<{ dedicated: boolean }>(sql`
    select exists (select 1 from public.tenant_host h where h.host = ${normalized}::text) as dedicated`))
  return row?.dedicated === true
}
