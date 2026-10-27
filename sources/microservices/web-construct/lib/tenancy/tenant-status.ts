import { sql } from 'drizzle-orm'
import type { TenantTx } from '@/lib/db/tenant-db'

/** Il tenant della transazione è sospeso o archiviato (o è il modello): niente inviti (MT5-DEC-25). */
export class TenantInactiveError extends Error {
  constructor() {
    super('tenant_inactive')
    this.name = 'TenantInactiveError'
  }
}

/**
 * Rifiuta, dentro la transazione del tenant, se il tenant non è attivo (MT5-DEC-25): un tenant
 * sospeso o archiviato non manda inviti. Legge lo stato nella stessa transazione che scrive il
 * token, così uno stato cambiato un attimo prima non si aggira.
 */
export async function assertTenantActive(tx: TenantTx): Promise<void> {
  const [row] = await tx.execute<{ active: boolean }>(sql`
    select exists (
      select 1 from public.tenant t
      where t.id = app_private.current_tenant_id() and t.status = 'active' and not t.is_template
    ) as active`)
  if (row?.active !== true) throw new TenantInactiveError()
}
