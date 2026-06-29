import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { buildNavTree } from './nav-tree-builder'
import {
  type UserNavigationTreeDto, type NavigationItemRow,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY, FUNCTIONALITY_TYPE_BY_ID,
} from './types'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

async function loadNavAndTags() {
  const supabase = createAdminClient()
  const [{ data: nav, error: navErr }, { data: tags, error: tagErr }] = await Promise.all([
    supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
    supabase.from('navigation_item_tag').select('id_item,tag_lan,tag'),
  ])
  if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
  if (tagErr) throw new Error(`Failed to load tags: ${tagErr.message}`)
  const tagsByItem = new Map<number, { tag_lan: string; tag: string }[]>()
  for (const t of (tags ?? []) as { id_item: number; tag_lan: string; tag: string }[]) {
    const arr = tagsByItem.get(t.id_item) ?? []
    arr.push({ tag_lan: t.tag_lan, tag: t.tag })
    tagsByItem.set(t.id_item, arr)
  }
  return { items: (nav ?? []) as NavigationItemRow[], tagsByItem }
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
  return {
    id: it.id_item,
    name: it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? '',
    type: it.id_item_type === ITEM_TYPE_CATEGORY ? 'CATEGORY' : 'FUNCTIONALITY',
    parentId: it.id_item_parent,
    authorization: false,
    description: it.item_translation?.[DEFAULT_LOCALE]?.description ?? null,
    functionalityType: it.id_functionality_type ? FUNCTIONALITY_TYPE_BY_ID[it.id_functionality_type] ?? null : null,
    link: it.functionality_link,
    icon: it.icon_path,
    navbarPosition: it.navbar_position,
    isImmutable: it.is_immutable === 1,
    translations: it.item_translation ?? {},
    tagTranslations,
    children: [],
  }
})

export const getParentList = cache(async (): Promise<{ id: number; name: string }[]> => {
  const { items } = await loadNavAndTags()
  return items
    .filter(i => i.id_item_type === ITEM_TYPE_CATEGORY && i.id_item !== ROOT_ID && i.id_item !== OPERATIONS_ID)
    .map(i => ({ id: i.id_item, name: i.item_translation?.[DEFAULT_LOCALE]?.name ?? i.name ?? '' }))
})
