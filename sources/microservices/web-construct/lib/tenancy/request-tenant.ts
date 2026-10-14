import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { DEFAULT_TENANT_SLUG, toTenantId, type TenantId } from './tenant-id'

// L'id di un tenant non cambia mai: si legge una volta per processo.
let defaultTenant: TenantId | null = null

/**
 * Il tenant della richiesta corrente. In questo pezzo è sempre quello predefinito (MTF-DEC-2):
 * nel pezzo 4 leggerà il token o l'host, e chi lo chiama non dovrà cambiare.
 */
export const resolveRequestTenant = cache(async (): Promise<TenantId> => {
  if (defaultTenant === null) {
    const [row] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, DEFAULT_TENANT_SLUG)))
    if (!row) throw new Error('default tenant missing')
    defaultTenant = toTenantId(row.id)
  }
  return defaultTenant
})
