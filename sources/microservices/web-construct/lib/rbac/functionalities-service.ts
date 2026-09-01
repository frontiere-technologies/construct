import { cache } from 'react'
import { asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, navigationItemTag } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { buildNavTree, mapRowToDto, selectableParents } from './nav-tree-builder'
import { type UserNavigationTreeDto, type ParentOption, ROOT_ID, OPERATIONS_ID } from './types'

async function loadNavAndTags() {
  const [navRows, tagRows] = await Promise.all([
    db.select().from(permission).orderBy(asc(permission.orderPosition)),
    db.select().from(navigationItemTag),
  ])
  const tagsByItem = new Map<number, { tag_lan: string; tag: string }[]>()
  for (const t of tagRows) {
    const arr = tagsByItem.get(t.idItem) ?? []
    arr.push({ tag_lan: t.tagLan, tag: t.tag })
    tagsByItem.set(t.idItem, arr)
  }
  return { items: navRows.map(toNavigationItemRow), tagsByItem }
}

export const getNavigationSubtree = cache(async (root: 'root' | 'operations'): Promise<UserNavigationTreeDto[]> => {
  const { items, tagsByItem } = await loadNavAndTags()
  return buildNavTree(items, tagsByItem, root === 'root' ? ROOT_ID : OPERATIONS_ID)
})

export const getNavigationItem = cache(async (id: number): Promise<UserNavigationTreeDto> => {
  const { items, tagsByItem } = await loadNavAndTags()
  const it = items.find(i => i.id_item === id)
  if (!it) throw new Error(`Navigation item ${id} not found`)
  const tagTranslations: Record<string, string[]> = {}
  for (const t of tagsByItem.get(id) ?? []) (tagTranslations[t.tag_lan] ??= []).push(t.tag)
  return mapRowToDto(it, { tagTranslations, children: [] })
})

/** Genitore choices. Pass the id of the item being edited so its own subtree is left out. */
export const getParentList = cache(async (excludeSubtreeOf?: number): Promise<ParentOption[]> => {
  const { items } = await loadNavAndTags()
  return selectableParents(items, excludeSubtreeOf)
})
