'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, NavigationItemRow } from './types'
import { ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY } from './types'

async function writeTags(
  supabase: ReturnType<typeof createAdminClient>,
  idItem: number,
  tagTranslations: Record<string, string[]>,
) {
  const rows: { tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ tag_lan: lan, tag: tag.trim() })
  }
  // Atomic replace (delete + insert in one transaction) — no partial-failure window.
  const { error } = await supabase.rpc('replace_item_tags', { p_id_item: idItem, p_rows: rows })
  if (error) throw new Error(`Failed to write tags: ${error.message}`)
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const supabase = createAdminClient()
  // Resolve the parent: explicit item parent takes precedence; otherwise use the active root (operations=-1 or root=0)
  const parent = input.idItemParent ?? input.idRootParent ?? ROOT_ID
  // next order_position among siblings of the chosen parent
  const { data: siblings, error: siblingError } = await supabase.from('navigation_item').select('order_position').eq('id_item_parent', parent)
  if (siblingError) throw new Error(`Failed to load siblings: ${siblingError.message}`)
  const nextOrder = (siblings ?? []).reduce((m: number, r: { order_position: number }) => Math.max(m, r.order_position + 1), 0)
  const { data, error } = await supabase.from('navigation_item').insert({
    name: input.name.trim(),
    id_item_type: input.idItemType,
    id_functionality_type: input.idItemType === 2 ? input.idFunctionalityType : null,
    functionality_link: input.idItemType === 2 ? input.functionalityLink : null,
    icon_path: sanitizeSvg(input.iconPath),
    id_item_parent: parent,
    order_position: nextOrder,
    description: input.description,
    item_translation: input.itemTranslation,
    is_immutable: 0, config_visibility: 0, no_permission_need_for_navigation: 0,
  }).select('id_item').single()
  if (error) throw new Error(`Failed to create item: ${error.message}`)
  await writeTags(supabase, Number(data.id_item), input.tagTranslations)
  return { id: Number(data.id_item) }
}

async function loadItems(supabase: ReturnType<typeof createAdminClient>): Promise<NavigationItemRow[]> {
  const { data, error } = await supabase.from('navigation_item')
    .select('id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation')
  if (error) throw new Error(`Failed to load items: ${error.message}`)
  return (data ?? []) as NavigationItemRow[]
}

async function assertMutable(supabase: ReturnType<typeof createAdminClient>, id: number) {
  const { data, error } = await supabase.from('navigation_item').select('is_immutable').eq('id_item', id).single()
  if (error) throw new Error(`Item not found: ${error.message}`)
  if ((data as { is_immutable: number }).is_immutable === 1) throw new Error('This item is immutable')
}

export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const supabase = createAdminClient()
  await assertMutable(supabase, id)
  const { error } = await supabase.from('navigation_item').update({
    name: input.name.trim(),
    id_item_type: input.idItemType,
    id_functionality_type: input.idItemType === 2 ? input.idFunctionalityType : null,
    functionality_link: input.idItemType === 2 ? input.functionalityLink : null,
    icon_path: sanitizeSvg(input.iconPath),
    description: input.description,
    item_translation: input.itemTranslation,
  }).eq('id_item', id)
  if (error) throw new Error(`Failed to update item: ${error.message}`)
  await writeTags(supabase, id, input.tagTranslations)
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  if (id === 0 || id === -1) throw new Error('Cannot move a root')
  const supabase = createAdminClient()
  await assertMutable(supabase, id)
  const items = await loadItems(supabase)
  if (isDescendant(items, move.targetParentId, id)) throw new Error('Cannot move an item into its own subtree')

  // Guard: target parent must be a virtual root or a category item
  const isVirtualRoot = move.targetParentId === ROOT_ID || move.targetParentId === OPERATIONS_ID
  if (!isVirtualRoot) {
    const targetItem = items.find(i => i.id_item === move.targetParentId)
    if (!targetItem || targetItem.id_item_type !== ITEM_TYPE_CATEGORY) {
      throw new Error('Target parent must be a category')
    }
  }

  // Re-parent the moved item, then renumber the destination siblings with it inserted at orderPosition.
  const dest = items
    .filter(i => i.id_item_parent === move.targetParentId && i.id_item !== id)
    .sort((a, b) => a.order_position - b.order_position)
    .map(i => i.id_item)
  const idx = Math.max(0, Math.min(move.orderPosition, dest.length))
  dest.splice(idx, 0, id)
  for (let pos = 0; pos < dest.length; pos++) {
    const { error } = await supabase.from('navigation_item')
      .update({ id_item_parent: move.targetParentId, order_position: pos })
      .eq('id_item', dest[pos])
    if (error) throw new Error(`Failed to move item: ${error.message}`)
  }
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  const items = await loadItems(supabase)
  if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')
  const { error } = await supabase.from('navigation_item').delete().eq('id_item', id)
  if (error) throw new Error(`Failed to delete item: ${error.message}`)
}
