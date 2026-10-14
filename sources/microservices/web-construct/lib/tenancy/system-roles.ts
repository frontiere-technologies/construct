import { cache } from 'react'
import { isNotNull } from 'drizzle-orm'
import { role } from '@/lib/db/schema'
import type { TenantTx } from '@/lib/db/tenant-db'

export interface SystemRoleIds {
  registered: number
  tenantAdmin: number
}

/**
 * I due ruoli di sistema del tenant della transazione, riconosciuti dalla chiave e non dall'id
 * (MTF-DEC-5): ogni tenant ha le proprie copie. La RLS limita la lettura al tenant corrente.
 * Memorizzata per transazione con cache() di React.
 */
export const getSystemRoleIds = cache(async (tx: TenantTx): Promise<SystemRoleIds> => {
  const rows = await tx.select({ idRole: role.idRole, systemKey: role.systemKey }).from(role).where(isNotNull(role.systemKey))
  const registered = rows.find(row => row.systemKey === 'REGISTERED')?.idRole
  const tenantAdmin = rows.find(row => row.systemKey === 'TENANT_ADMIN')?.idRole
  if (registered === undefined || tenantAdmin === undefined) throw new Error('system roles missing')
  return { registered, tenantAdmin }
})
