import { cache } from 'react'
import { asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { menuEntry, menuEntryTag } from '@/lib/db/schema'
import { toMenuEntryRow } from './nav-row-mapper'
import { buildNavTree, mapRowToDto, selectableParents } from './nav-tree-builder'
import { type UserNavigationTreeDto, type ParentOption } from './types'

async function loadNavAndTags() {
  const [navRows, tagRows] = await Promise.all([
    db.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    db.select().from(menuEntryTag),
  ])
  const tagsByItem = new Map<number, { tag_lan: string; tag: string }[]>()
  for (const t of tagRows) {
    const arr = tagsByItem.get(t.idMenuEntry) ?? []
    arr.push({ tag_lan: t.tagLan, tag: t.tag })
    tagsByItem.set(t.idMenuEntry, arr)
  }
  return { items: navRows.map(toMenuEntryRow), tagsByItem }
}

// L'albero mostrato dalla pagina Funzionalità è l'albero del menu, non quello dei permessi:
// un solo albero, radicato nell'assenza di genitore (Task 5) — non più due (root/operations).
export const getNavigationSubtree = cache(async (): Promise<UserNavigationTreeDto[]> => {
  const { items, tagsByItem } = await loadNavAndTags()
  return buildNavTree(items, tagsByItem)
})

export const getNavigationItem = cache(async (id: number): Promise<UserNavigationTreeDto> => {
  const { items, tagsByItem } = await loadNavAndTags()
  const it = items.find(i => i.id_menu_entry === id)
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
