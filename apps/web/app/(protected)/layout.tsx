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

  if (error) throw new Error(`Failed to load menu: ${error.message}`)

  if (!data || data.length === 0) {
    const { error: seedError } = await supabase
      .from('menu_items')
      .upsert(defaultMenu.map(mapToDb), { ignoreDuplicates: true })
    if (seedError) throw new Error(`Failed to seed menu: ${seedError.message}`)
    return defaultMenu
  }

  return data.map(mapFromDb)
}

async function getUserRole(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'user'
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  return data?.role ?? 'user'
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, userRole] = await Promise.all([getMenuItems(), getUserRole()])

  const filteredItems = menuItems.filter(i =>
    i.roles.length === 0 || i.roles.includes(userRole)
  )

  return <Layout menuItems={filteredItems}>{children}</Layout>
}
