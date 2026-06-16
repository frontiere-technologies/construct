import { createClient } from '@/lib/supabase-browser'
import { mapToDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export async function saveMenuItems(previousItems: MenuItem[], newItems: MenuItem[]): Promise<void> {
  const supabase = createClient()

  const newIds = new Set(newItems.map(i => i.id))
  const deletedIds = previousItems.map(i => i.id).filter(id => !newIds.has(id))

  if (deletedIds.length > 0) {
    const { error } = await supabase.from('menu_items').delete().in('id', deletedIds)
    if (error) throw new Error(error.message)
  }

  if (newItems.length > 0) {
    const { error } = await supabase
      .from('menu_items')
      .upsert(newItems.map(mapToDb), { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}
