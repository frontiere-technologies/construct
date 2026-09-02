'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { permission } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, NavigationItemRow } from './types'
import { ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY } from './types'

type NavigationDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

async function lockNavigationWrites(database: NavigationDatabase) {
  await database.execute(sql`select pg_advisory_xact_lock(49374201)`)
}

async function writeTags(database: NavigationDatabase, idItem: number, tagTranslations: Record<string, string[]>) {
  const rows: { tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ tag_lan: lan, tag: tag.trim() })
  }
  // Atomic replace (delete + insert in one transaction) via the schema.sql RPC (DEC-3).
  try {
    await database.execute(sql`select public.replace_item_tags(${idItem}, ${JSON.stringify(rows)}::jsonb)`)
  } catch (err) {
    throw new Error(`Failed to write tags: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const parent = input.idItemParent ?? input.idRootParent ?? ROOT_ID
  // kind è NOT NULL da 0015: stessa mappatura del backfill della migrazione
  // (id_item_type 1 = CATEGORY, altrimenti GRANT). Un permesso creato dalla
  // console nasce con origin = 'CONSOLE' (default della colonna) e code
  // nullo: permission_code_matches_kind lo impone solo per origin = 'SOURCE'
  // (DEC-14) — non c'e' nessun code da generare qui.
  const kind = input.idItemType === 1 ? 'CATEGORY' : 'GRANT'

  try {
    const created = await db.transaction(async tx => {
      await lockNavigationWrites(tx)
      const siblings = await tx.select({ orderPosition: permission.orderPosition }).from(permission).where(eq(permission.idParent, parent))
      const nextOrder = siblings.reduce((m, r) => Math.max(m, r.orderPosition + 1), 0)
      const [row] = await tx
        .insert(permission)
        .values({
          name: input.name.trim(),
          idItemType: input.idItemType,
          idFunctionalityType: input.idItemType === 2 ? input.idFunctionalityType : null,
          functionalityLink: input.idItemType === 2 ? input.functionalityLink : null,
          iconPath: sanitizeSvg(input.iconPath),
          openInNewTab: input.openInNewTab === false ? 0 : 1,
          idParent: parent,
          orderPosition: nextOrder,
          description: input.description,
          itemTranslation: input.itemTranslation,
          isImmutable: 0,
          configVisibility: 0,
          noPermissionNeedForNavigation: 0,
          kind,
        })
        .returning({ idItem: permission.idPermission })
      await writeTags(tx, row.idItem, input.tagTranslations)
      return row
    })
    revalidatePath('/', 'layout')
    return { id: created.idItem }
  } catch (err) {
    throw new Error(`Failed to create item: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function loadItems(database: NavigationDatabase = db): Promise<NavigationItemRow[]> {
  try {
    const rows = await database.select().from(permission)
    return rows.map(toNavigationItemRow)
  } catch (err) {
    throw new Error(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function assertMutable(id: number, database: NavigationDatabase = db) {
  let row: { isImmutable: number } | undefined
  try {
    ;[row] = await database.select({ isImmutable: permission.isImmutable }).from(permission).where(eq(permission.idPermission, id)).limit(1)
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
async function reparent(database: NavigationDatabase, items: NavigationItemRow[], id: number, targetParentId: number, orderPosition: number) {
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
      await database.update(permission).set({ idParent: targetParentId, orderPosition: pos }).where(eq(permission.idPermission, dest[pos]))
    } catch (err) {
      throw new Error(`Failed to move item: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  try {
    await db.transaction(async tx => {
      await lockNavigationWrites(tx)
      await assertMutable(id, tx)
      if (input.idItemParent != null) {
        const items = await loadItems(tx)
        const current = items.find(i => i.id_item === id)
        if (current && current.id_item_parent !== input.idItemParent) {
          const siblings = items.filter(i => i.id_item_parent === input.idItemParent && i.id_item !== id).length
          await reparent(tx, items, id, input.idItemParent, siblings)
        }
      }
      await tx
        .update(permission)
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
        .where(eq(permission.idPermission, id))
      await writeTags(tx, id, input.tagTranslations)
    })
  } catch (err) {
    throw new Error(`Failed to update item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  if (id === 0 || id === -1) throw new Error('Cannot move a root')
  await db.transaction(async tx => {
    await lockNavigationWrites(tx)
    await assertMutable(id, tx)
    const items = await loadItems(tx)
    await reparent(tx, items, id, move.targetParentId, move.orderPosition)
  })
  revalidatePath('/', 'layout')
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  try {
    await db.transaction(async tx => {
      await lockNavigationWrites(tx)
      const items = await loadItems(tx)
      if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')
      await tx.delete(permission).where(eq(permission.idPermission, id))
    })
  } catch (err) {
    throw new Error(`Failed to delete item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}
