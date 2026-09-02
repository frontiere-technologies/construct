import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { menuEntry, rolePermission } from '@/lib/db/schema'
import type { MenuItem } from '@/types/menu'
import { toMenuEntryRow } from './nav-row-mapper'
import { resolveGrantedPermissionIds, mapMenuToSidebar } from './sidebar-adapter'
import { DEFAULT_LOCALE, type Locale, type MenuEntryRow } from './types'

export const getSidebarMenu = cache(async (
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => {
  const [entryRows, grantRows] = await Promise.all([
    db.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: rolePermission.idRole, id_permission: rolePermission.idPermission })
          .from(rolePermission)
          .where(inArray(rolePermission.idRole, roleIds))
      : Promise.resolve([]),
  ])
  const entries = entryRows.map(toMenuEntryRow)
  const granted = resolveGrantedPermissionIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, locale, fallbackLocale)
})

// La rotta /embedded/{id} usa l'identificativo della VOCE di menu (sidebar-adapter la
// costruisce da entry.id_menu_entry), non quello del permesso: da quando i due alberi hanno
// sequenze separate (Task 5), i due numeri non coincidono più per le voci create dopo la
// migrazione. Leggere qui da `permission` risolverebbe l'id sbagliato — o nessuno.
export async function getNavigationItemById(idMenuEntry: number): Promise<MenuEntryRow | null> {
  const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, idMenuEntry)).limit(1)
  return row ? toMenuEntryRow(row) : null
}
