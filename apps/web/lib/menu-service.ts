import { cache } from 'react'
import { createClient } from '@/lib/supabase-server'
import { mapFromDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export const getMenuItems = cache(async (): Promise<MenuItem[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)
  return (data ?? []).map(mapFromDb)
})
