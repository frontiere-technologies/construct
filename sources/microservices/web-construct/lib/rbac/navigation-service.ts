import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, rolePermission } from '@/lib/db/schema'
import type { MenuItem } from '@/types/menu'
import { toNavigationItemRow } from './nav-row-mapper'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import { DEFAULT_LOCALE, type Locale, type NavigationItemRow, type RoleItemRow } from './types'

export const getSidebarMenu = cache(async (
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => {
  const [navRows, roleRows] = await Promise.all([
    db.select().from(permission).orderBy(asc(permission.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: rolePermission.idRole, id_item: rolePermission.idPermission, authorized: rolePermission.authorized })
          .from(rolePermission)
          .where(inArray(rolePermission.idRole, roleIds))
      : Promise.resolve([]),
  ])

  const items = navRows.map(toNavigationItemRow)
  const roleItems = roleRows as RoleItemRow[]
  const authorized = resolveAuthorizedItemIds(items, roleItems, roleIds)
  return mapNavigationToSidebar(items, authorized, locale, fallbackLocale)
})

export async function getNavigationItemById(idItem: number): Promise<NavigationItemRow | null> {
  const [row] = await db.select().from(permission).where(eq(permission.idPermission, idItem)).limit(1)
  return row ? toNavigationItemRow(row) : null
}
