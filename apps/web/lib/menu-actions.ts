'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { mapToDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export async function upsertMenuItem(item: MenuItem): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('menu_items')
    .upsert(mapToDb(item), { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteMenuItem(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateMenuItemOrders(
  updates: Array<{ id: string; order: number }>
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('update_menu_orders', { updates })
  if (error) throw new Error(error.message)
}
