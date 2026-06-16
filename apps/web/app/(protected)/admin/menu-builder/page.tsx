import { createClient } from '@/lib/supabase-server'
import { defaultMenu, mapFromDb } from '@/lib/menu-utils'
import { AdminMenuBuilder } from '@/components/AdminMenuBuilder'
import type { MenuItem } from '@/types/menu'

async function getMenuItems(): Promise<MenuItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('menu_items').select('*').order('order')
  if (error || !data || data.length === 0) return defaultMenu
  return data.map(mapFromDb)
}

export default async function MenuBuilderPage() {
  const menuItems = await getMenuItems()
  return <AdminMenuBuilder initialMenuItems={menuItems} />
}
