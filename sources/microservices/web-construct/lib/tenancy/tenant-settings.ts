import { tenantSettings } from '@/lib/db/schema'
import { withTenant } from '@/lib/db/tenant-db'
import type { TenantId } from './tenant-id'

/**
 * Se il tenant accetta registrazioni autonome (specifica 2026-10-21, MT4-DEC-10). Una riga mancante
 * (l'app può cancellarla) vale «no»: è il valore di partenza di ogni tenant nuovo.
 */
export async function readSelfRegistration(tenantId: TenantId): Promise<boolean> {
  const rows = await withTenant(tenantId, tx => tx.select({ on: tenantSettings.selfRegistration }).from(tenantSettings).limit(1))
  return rows[0]?.on ?? false
}
