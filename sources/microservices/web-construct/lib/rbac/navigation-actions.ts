'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { navigationItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, NavigationItemRow } from './types'
import { ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY } from './types'

async function writeTags(idItem: number, tagTranslations: Record<string, string[]>) {
  const rows: { tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ tag_lan: lan, tag: tag.trim() })
  }
  // Atomic replace (delete + insert in one transaction) via the schema.sql RPC (DEC-3).
  try {
    await db.execute(sql`select public.replace_item_tags(${idItem}, ${JSON.stringify(rows)}::jsonb)`)
  } catch (err) {
    throw new Error(`Failed to write tags: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const parent = input.idItemParent ?? input.idRootParent ?? ROOT_ID

  let nextOrder: number
  try {
    const siblings = await db.select({ orderPosition: navigationItem.orderPosition }).from(navigationItem).where(eq(navigationItem.idItemParent, parent))
    nextOrder = siblings.reduce((m, r) => Math.max(m, r.orderPosition + 1), 0)
  } catch (err) {
    throw new Error(`Failed to load siblings: ${err instanceof Error ? err.message : String(err)}`)
  }

  let created: { idItem: number }
  try {
    ;[created] = await db
      .insert(navigationItem)
      .values({
        name: input.name.trim(),
        idItemType: input.idItemType,
        idFunctionalityType: input.idItemType === 2 ? input.idFunctionalityType : null,
        functionalityLink: input.idItemType === 2 ? input.functionalityLink : null,
        iconPath: sanitizeSvg(input.iconPath),
        openInNewTab: input.openInNewTab === false ? 0 : 1,
        idItemParent: parent,
        orderPosition: nextOrder,
        description: input.description,
        itemTranslation: input.itemTranslation,
        isImmutable: 0,
        configVisibility: 0,
        noPermissionNeedForNavigation: 0,
      })
      .returning({ idItem: navigationItem.idItem })
  } catch (err) {
    throw new Error(`Failed to create item: ${err instanceof Error ? err.message : String(err)}`)
  }
  await writeTags(created.idItem, input.tagTranslations)
  revalidatePath('/', 'layout')
  return { id: created.idItem }
}

async function loadItems(): Promise<NavigationItemRow[]> {
  try {
    const rows = await db.select().from(navigationItem)
    return rows.map(toNavigationItemRow)
  } catch (err) {
    throw new Error(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function assertMutable(id: number) {
  let row: { isImmutable: number } | undefined
  try {
    ;[row] = await db.select({ isImmutable: navigationItem.isImmutable }).from(navigationItem).where(eq(navigationItem.idItem, id)).limit(1)
  } catch (err) {
    throw new Error(`Item not found: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!row) throw new Error('Item not found: no rows')
  if (row.isImmutable === 1) throw new Error('This item is immutable')
}

/**
 * Reparent `id` under `targetParentId` at `orderPosition`, renumbering the destination's
 * children. Shared by moveNavigationItem (drag & drop in the tree) and updateNavigationItem
 * (the Genitore dropdown in the form). Callers must have asserted `id` is mutable.
 */
async function reparent(items: NavigationItemRow[], id: number, targetParentId: number, orderPosition: number) {
  if (isDescendant(items, targetParentId, id)) throw new Error('Cannot move an item into its own subtree')

  const isVirtualRoot = targetParentId === ROOT_ID || targetParentId === OPERATIONS_ID
  if (!isVirtualRoot) {
    const targetItem = items.find(i => i.id_item === targetParentId)
    if (!targetItem || targetItem.id_item_type !== ITEM_TYPE_CATEGORY) {
      throw new Error('Target parent must be a category')
    }
  }

  const dest = items
    .filter(i => i.id_item_parent === targetParentId && i.id_item !== id)
    .sort((a, b) => a.order_position - b.order_position)
    .map(i => i.id_item)
  const idx = Math.max(0, Math.min(orderPosition, dest.length))
  dest.splice(idx, 0, id)
  for (let pos = 0; pos < dest.length; pos++) {
    try {
      await db.update(navigationItem).set({ idItemParent: targetParentId, orderPosition: pos }).where(eq(navigationItem.idItem, dest[pos]))
    } catch (err) {
      throw new Error(`Failed to move item: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  await assertMutable(id)

  // Genitore change: validate and move first, so an illegal target aborts before any write.
  if (input.idItemParent != null) {
    const items = await loadItems()
    const current = items.find(i => i.id_item === id)
    if (current && current.id_item_parent !== input.idItemParent) {
      // Append as the last child of the new parent, like a freshly created item.
      const siblings = items.filter(i => i.id_item_parent === input.idItemParent && i.id_item !== id).length
      await reparent(items, id, input.idItemParent, siblings)
    }
  }

  try {
    await db
      .update(navigationItem)
      .set({
        name: input.name.trim(),
        idItemType: input.idItemType,
        idFunctionalityType: input.idItemType === 2 ? input.idFunctionalityType : null,
        functionalityLink: input.idItemType === 2 ? input.functionalityLink : null,
        iconPath: sanitizeSvg(input.iconPath),
        openInNewTab: input.openInNewTab === false ? 0 : 1,
        description: input.description,
        itemTranslation: input.itemTranslation,
      })
      .where(eq(navigationItem.idItem, id))
  } catch (err) {
    throw new Error(`Failed to update item: ${err instanceof Error ? err.message : String(err)}`)
  }
  await writeTags(id, input.tagTranslations)
  revalidatePath('/', 'layout')
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  if (id === 0 || id === -1) throw new Error('Cannot move a root')
  await assertMutable(id)
  const items = await loadItems()
  await reparent(items, id, move.targetParentId, move.orderPosition)
  revalidatePath('/', 'layout')
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  const items = await loadItems()
  if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')
  try {
    await db.delete(navigationItem).where(eq(navigationItem.idItem, id))
  } catch (err) {
    throw new Error(`Failed to delete item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}
