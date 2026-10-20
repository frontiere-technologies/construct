import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
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
  // Insieme: postgres.js le mette in coda sulla stessa connessione (specifica 2026-10-15, §2.5).
  const [entryRows, grantRows] = await Promise.all([
    tx.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    roleIds.length
      ? tx.select({ id_role: roleFunctionality.idRole, id_menu_entry: roleFunctionality.idMenuEntry })
        .from(roleFunctionality)
        .where(inArray(roleFunctionality.idRole, roleIds))
      : Promise.resolve([]),
  ])
  const entries = entryRows.map(toMenuEntryRow)
  const granted = resolveGrantedFunctionalityIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, locale, fallbackLocale)
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
