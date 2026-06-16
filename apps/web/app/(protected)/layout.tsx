import { createClient } from '@/lib/supabase-server'
import { defaultMenu, mapFromDb, mapToDb } from '@/lib/menu-utils'
import { Layout } from '@/components/Layout'
import type { MenuItem } from '@/types/menu'

async function getMenuItems(): Promise<MenuItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('order')

  if (error) return defaultMenu

  if (!data || data.length === 0) {
    await supabase.from('menu_items').insert(defaultMenu.map(mapToDb))
    return defaultMenu
  }

  return data.map(mapFromDb)
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const menuItems = await getMenuItems()

  return <Layout menuItems={menuItems}>{children}</Layout>
}
