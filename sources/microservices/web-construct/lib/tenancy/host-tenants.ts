import { sql } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { normalizeHost } from './request-host'
import { mainBaseUrl } from './tenant-base-url'
import { isMultiTenantEnabled } from './tenancy-mode'
import { DEFAULT_TENANT_SLUG, toTenantId, type TenantId } from './tenant-id'

/** Un tenant che la persona può usare sull'indirizzo della richiesta (specifica 2026-10-21, §2.4). */
export type AvailableTenant = { tenantId: TenantId; name: string; isAdmin: boolean }

/** In single solo l'host dell'origine configurata è un ingresso valido. */
export function isCanonicalTenantHost(host: string | null): boolean {
  const canonical = normalizeHost(new URL(mainBaseUrl()).host)
  return canonical !== null && normalizeHost(host) === canonical
}

/**
 * I tenant che rispondono sull'indirizzo e dove la persona ha un'appartenenza attiva, con l'account
 * attivo a livello globale; ordinati per nome (MT4-DEC-2). `host` nullo, sconosciuto o non valido
 * è l'indirizzo principale. Le appartenenze sono tabelle di tenant: le legge la funzione SQL, che
 * visita i tenant uno per uno e rimette `app.tenant_id` com'era (0054). Un solo viaggio, ma la
 * funzione scorre i tenant dell'indirizzo: si chiama all'accesso, al cambio e quando la
 * rivalidazione fallisce, mai a ogni richiesta. L'ordine è scritto qui e non affidato all'ordine
 * in cui la funzione restituisce le righe. In single si espone solo il default, e solo sul
 * nome host dell’origine canonica configurata; gli altri indirizzi non sono ingressi validi.
 */
export async function listAvailableTenants(userId: string, host: string | null): Promise<AvailableTenant[]> {
  const single = !isMultiTenantEnabled()
  if (single && !isCanonicalTenantHost(host)) return []
  const rows = await withGlobal(tx => tx.execute<{ id_tenant: string; name: string; is_admin: boolean }>(sql`
    select a.id_tenant::text as id_tenant, a.name, a.is_admin
    from public.available_tenants(${userId}::uuid, ${single ? null : normalizeHost(host)}::text) a
    where ${!single} or a.id_tenant = (select t.id from public.tenant t where t.slug = ${DEFAULT_TENANT_SLUG})
    order by a.name, a.id_tenant`))
  return rows.map(row => ({ tenantId: toTenantId(Number(row.id_tenant)), name: row.name, isAdmin: row.is_admin }))
}

/**
 * Il tenant dell'indirizzo prima dell'accesso (MT4-DEC-1, MT4-DEC-11): quello a cui l'indirizzo è
 * dedicato nel registro, altrimenti il predefinito. Non guarda lo stato del tenant: decide il tema
 * e le pagine pubbliche, e chi entra passa comunque da `listAvailableTenants`. In single il
 * registro degli host non sceglie tenant: le pagine pubbliche usano sempre il default.
 */
export async function resolveHostTenant(host: string | null): Promise<TenantId> {
  const single = !isMultiTenantEnabled()
  const [row] = await withGlobal(tx => tx.execute<{ id: string | null }>(sql`
    select coalesce(
      (select h.id_tenant from public.tenant_host h where h.host = ${single ? null : normalizeHost(host)}::text),
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
  if (!isMultiTenantEnabled()) {
    if (!isCanonicalTenantHost(host)) return false
    const tenantId = await resolveHostTenant(host)
    const [row] = await withTenant(tenantId, tx => tx.execute<{ deactivated: boolean }>(sql`
      select exists (select 1 from public.tenant_membership m join public.tenant t on t.id = m.id_tenant
        where m.user_id = ${userId}::uuid and m.status = 'deactivated') as deactivated`))
    return row?.deactivated === true
  }
  const [row] = await withGlobal(tx => tx.execute<{ deactivated: boolean }>(sql`
    select public.has_deactivated_membership_on_host(${userId}::uuid, ${normalizeHost(host)}::text) as deactivated`))
  return row?.deactivated === true
}

/**
 * Vero se la persona ha un'appartenenza attiva in un tenant sospeso o archiviato di questo
 * indirizzo (MT5-DEC-7, MT5-DEC-8): chi non ha nessun tenant disponibile lì vede allora «Questo
 * spazio è sospeso» invece del generico «Non sei configurato». Come `listAvailableTenants` scorre i
 * tenant dell'indirizzo (quelli non attivi, il modello escluso): si chiama solo quando non c'è
 * nessun tenant disponibile.
 */
export async function hasInactiveMembershipOnHost(userId: string, host: string | null): Promise<boolean> {
  if (!isMultiTenantEnabled()) {
    if (!isCanonicalTenantHost(host)) return false
    const tenantId = await resolveHostTenant(host)
    const [row] = await withTenant(tenantId, tx => tx.execute<{ inactive: boolean }>(sql`
      select exists (select 1 from public.tenant_membership m join public.tenant t on t.id = m.id_tenant
        where m.user_id = ${userId}::uuid and m.status = 'active' and t.status <> 'active') as inactive`))
    return row?.inactive === true
  }
  const [row] = await withGlobal(tx => tx.execute<{ inactive: boolean }>(sql`
    select public.has_inactive_membership_on_host(${userId}::uuid, ${normalizeHost(host)}::text) as inactive`))
  return row?.inactive === true
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
