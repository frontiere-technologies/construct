'use server'

import { sql } from 'drizzle-orm'
import { tenantSettings } from '@/lib/db/schema'
import { withTenant } from '@/lib/db/tenant-db'
import { requirePermission } from '@/lib/rbac/auth-guard'

/**
 * Accende o spegne le registrazioni autonome del tenant in cui lavora chi chiama (specifica
 * 2026-10-21, §3.2, MT4-DEC-10). Il tenant è quello dell'attore, letto dal token rivalidato: non
 * c'è un parametro che lo dica, quindi il client non può indicarne un altro. Scrive con un upsert:
 * se la riga manca (l'app può cancellarla e vale «no») la crea, invece di non cambiare niente.
 * Un rifiuto o un errore del database lanciano: la pagina li mostra come salvataggio fallito.
 */
export async function setSelfRegistration(enabled: boolean): Promise<void> {
  const actor = await requirePermission('manage-tenant-settings')
  // Un'azione server riceve quello che manda il client, non quello che dice il tipo.
  const selfRegistration = enabled === true
  await withTenant(actor.tenantId, tx => tx.insert(tenantSettings)
    .values({ selfRegistration })
    // `id_tenant` si compila dal contesto (default `app_private.current_tenant_id()`), il conflitto cade sulla chiave.
    .onConflictDoUpdate({ target: tenantSettings.idTenant, set: { selfRegistration, updatedAt: sql`now()` } }))
}
