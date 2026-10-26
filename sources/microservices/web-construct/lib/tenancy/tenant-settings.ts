import { sql } from 'drizzle-orm'
import { tenantSettings } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { DEFAULT_TENANT_SLUG, type TenantId } from './tenant-id'

/**
 * Se il tenant accetta registrazioni autonome (specifica 2026-10-21, MT4-DEC-10). Una riga mancante
 * (l'app può cancellarla) vale «no»: è il valore di partenza di ogni tenant nuovo.
 */
export async function readSelfRegistration(tenantId: TenantId): Promise<boolean> {
  const rows = await withTenant(tenantId, tx => tx.select({ on: tenantSettings.selfRegistration }).from(tenantSettings).limit(1))
  return rows[0]?.on ?? false
}

/**
 * Se una registrazione dall'indirizzo del tenant può farvi entrare qualcuno (MT4-DEC-9, MT4-DEC-10):
 * tenant attivo, non il modello, con l'interruttore acceso; una riga di impostazioni mancante vale
 * spento. È la stessa condizione con cui `public.join_by_registration` (0054) rifiuta, letta prima:
 * la registrazione la controlla prima di creare l'account, così con l'interruttore spento non si
 * crea nulla (MT4-OK-5). La funzione SQL la ricontrolla comunque al momento dell'ingresso.
 */
export async function acceptsSelfRegistration(tenantId: TenantId): Promise<boolean> {
  const [row] = await withTenant(tenantId, tx => tx.execute<{ accepts: boolean }>(sql`
    select exists (
      select 1
      from public.tenant t
      join public.tenant_settings s on s.id_tenant = t.id
      where t.id = ${tenantId} and t.status = 'active' and not t.is_template and s.self_registration
    ) as accepts`))
  return row?.accepts === true
}

/**
 * Se l'interruttore delle registrazioni autonome ha effetto sul tenant (MT4-DEC-9, MT4-DEC-10): solo
 * per il tenant predefinito, in cui entra chi si registra dall'indirizzo principale, e per un tenant
 * con un indirizzo dedicato. Senza un indirizzo suo nessuno può registrarsi nel tenant, e la pagina
 * delle impostazioni lo spiega al posto dell'interruttore.
 */
export async function selfRegistrationApplies(tenantId: TenantId): Promise<boolean> {
  const [row] = await withGlobal(tx => tx.execute<{ applies: boolean }>(sql`
    select exists (select 1 from public.tenant t where t.id = ${tenantId} and t.slug = ${DEFAULT_TENANT_SLUG})
      or exists (select 1 from public.tenant_host h where h.id_tenant = ${tenantId}) as applies`))
  return row?.applies === true
}
