import { cache } from 'react'
import { eq, inArray, sql } from 'drizzle-orm'
import { tenantPolicySelection, tenantPolicyFromData, type TenantPolicyData } from '@/lib/tenancy/tenant-policy-service'
import { allInTransaction } from '@/lib/db/all-in-transaction'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { menuEntry, roleFunctionality } from '@/lib/db/schema'
import type { MenuItem } from '@/types/menu'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { toMenuEntryRow } from './nav-row-mapper'
import { resolveGrantedFunctionalityIds, mapMenuToSidebar } from './sidebar-adapter'
import { DEFAULT_LOCALE, type Locale, type MenuEntryRow } from './types'

export const getSidebarMenu = cache(async (
  tenantId: TenantId,
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => withTenant(tenantId, async tx => {
  // Voci (senza parametri) e concessioni (con parametri): postgres.js le mette in coda insieme sulla
  // stessa connessione (specifica 2026-10-15, §2.5). Ogni ramo è una sola istruzione.
  const [menuRows, grantRows] = await allInTransaction([
    tx.execute<{ entries: MenuEntryRow[]; policy: TenantPolicyData }>(sql`
      select coalesce((select jsonb_agg(m order by m.order_position) from ${menuEntry} m), '[]'::jsonb) as entries,
        row_to_json(p) as policy from (${tenantPolicySelection}) p`),
    roleIds.length
      ? tx.select({ id_role: roleFunctionality.idRole, id_menu_entry: roleFunctionality.idMenuEntry })
        .from(roleFunctionality)
        .where(inArray(roleFunctionality.idRole, roleIds))
      : Promise.resolve([]),
  ])
  const result = menuRows[0]
  const policy = tenantPolicyFromData(result?.policy)
  const entries = result.entries
  const granted = resolveGrantedFunctionalityIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, policy, locale, fallbackLocale)
}))

// La rotta /embedded/{id} usa l'identificativo della VOCE di menu (sidebar-adapter la
// costruisce da entry.id_menu_entry), non quello del permesso: da quando i due alberi hanno
// sequenze separate (Task 5), i due numeri non coincidono più per le voci create dopo la
// migrazione. Leggere qui da `permission` risolverebbe l'id sbagliato — o nessuno.
export async function selectNavigationItemById(tx: TenantTx, idMenuEntry: number): Promise<MenuEntryRow | null> {
  const [row] = await tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, idMenuEntry)).limit(1)
  return row ? toMenuEntryRow(row) : null
}

export async function getNavigationItemById(tenantId: TenantId, idMenuEntry: number): Promise<MenuEntryRow | null> {
  return withTenant(tenantId, tx => selectNavigationItemById(tx, idMenuEntry))
}
