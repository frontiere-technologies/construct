import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { NavigationItemRow, RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

export const getSidebarMenu = cache(async (roleIds: number[]): Promise<MenuItem[]> => {
  const supabase = createAdminClient()
  const [{ data: navRows, error: navErr }, { data: roleRows, error: roleErr }] = await Promise.all([
    supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
    roleIds.length
      ? supabase.from('role_item').select('id_role,id_item,authorized').in('id_role', roleIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
  if (roleErr) throw new Error(`Failed to load permissions: ${roleErr.message}`)

  const items = (navRows ?? []) as NavigationItemRow[]
  const roleItems = (roleRows ?? []) as RoleItemRow[]
  const authorized = resolveAuthorizedItemIds(items, roleItems, roleIds)
  return mapNavigationToSidebar(items, authorized)
})
