import { cache } from 'react'
import { toTenantId, type TenantId } from './tenant-id'

/**
 * Il tenant della richiesta corrente. In questo pezzo è sempre quello predefinito (MTF-DEC-2):
 * nel pezzo 4 leggerà il token o l'host, e chi lo chiama non dovrà cambiare.
 */
export const resolveRequestTenant = cache(async (): Promise<TenantId> => toTenantId(1))
