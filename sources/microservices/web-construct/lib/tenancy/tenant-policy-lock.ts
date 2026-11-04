import { sql } from 'drizzle-orm'
import type { PlatformAuditTx } from '@/lib/audit/audit-types'
import type { TenantTx } from '@/lib/db/tenant-db'

/** Ordine: policy del tenant -> riga tenant, se serve -> blocchi membri/menu/ruoli. */
export async function lockTenantPolicy(tx: TenantTx | PlatformAuditTx): Promise<void> {
  await tx.execute(sql`select app_private.lock_tenant_policy()`)
}
