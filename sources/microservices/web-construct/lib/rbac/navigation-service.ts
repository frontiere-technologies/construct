import { cache } from 'react'
import { asc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'

export const getSidebarMenu = cache(async (roleIds: number[]): Promise<MenuItem[]> => {
  const [navRows, roleRows] = await Promise.all([
    db.select().from(navigationItem).orderBy(asc(navigationItem.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: roleItem.idRole, id_item: roleItem.idItem, authorized: roleItem.authorized })
          .from(roleItem)
          .where(inArray(roleItem.idRole, roleIds))
      : Promise.resolve([]),
  ])

  const items = navRows.map(toNavigationItemRow)
  const roleItems = roleRows as RoleItemRow[]
  const authorized = resolveAuthorizedItemIds(items, roleItems, roleIds)
  return mapNavigationToSidebar(items, authorized)
})
