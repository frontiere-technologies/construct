import { cache } from 'react'
import { createAdminClient, createAnonClient } from '@/lib/supabase-server'
import { mapFromDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export const getMenuItems = cache(async (): Promise<MenuItem[]> => {
  // Use admin client when the service role key is available; fall back to anon client
  // (safe because RLS is disabled on menu_items — Task 9).
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : createAnonClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)
  return (data ?? []).map(mapFromDb)
})
