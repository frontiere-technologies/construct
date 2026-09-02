import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { menuEntry, permission, rolePermission } from '@/lib/db/schema'
import type { MenuItem } from '@/types/menu'
import { toMenuEntryRow, toNavigationItemRow } from './nav-row-mapper'
import { resolveGrantedPermissionIds, mapMenuToSidebar } from './sidebar-adapter'
import { DEFAULT_LOCALE, type Locale, type NavigationItemRow } from './types'

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

export async function getNavigationItemById(idItem: number): Promise<NavigationItemRow | null> {
  const [row] = await db.select().from(permission).where(eq(permission.idPermission, idItem)).limit(1)
  return row ? toNavigationItemRow(row) : null
}
