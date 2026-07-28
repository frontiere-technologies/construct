import {
  type NavigationItemRow, type UserNavigationTreeDto, type Locale, type ParentOption,
  DEFAULT_LOCALE, ITEM_TYPE_CATEGORY, FUNCTIONALITY_TYPE_BY_ID, ROOT_ID, OPERATIONS_ID,
} from './types'

export function mapRowToDto(
  it: NavigationItemRow,
  opts: { tagTranslations: Record<string, string[]>; children: UserNavigationTreeDto[]; locale?: Locale },
): UserNavigationTreeDto {
  const locale = opts.locale ?? DEFAULT_LOCALE
  return {
    id: it.id_item,
    name: it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? '',
    type: it.id_item_type === ITEM_TYPE_CATEGORY ? 'CATEGORY' : 'FUNCTIONALITY',
    parentId: it.id_item_parent,
    authorization: false,
    description: it.item_translation?.[locale]?.description ?? it.item_translation?.[DEFAULT_LOCALE]?.description ?? null,
    functionalityType: it.id_functionality_type ? FUNCTIONALITY_TYPE_BY_ID[it.id_functionality_type] ?? null : null,
    link: it.functionality_link,
    icon: it.icon_path,
    navbarPosition: it.navbar_position,
    isImmutable: it.is_immutable === 1,
    openInNewTab: it.open_in_new_tab !== 0,
    translations: it.item_translation ?? {},
    tagTranslations: opts.tagTranslations,
    children: opts.children,
  }
}

export function buildNavTree(
  items: NavigationItemRow[],
  tagsByItem: Map<number, { tag_lan: string; tag: string }[]>,
  rootId: number,
  locale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const childrenByParent = new Map<number | null, NavigationItemRow[]>()
  for (const it of items) {
    if (it.config_visibility === 1) continue
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const tagsFor = (id: number): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const t of tagsByItem.get(id) ?? []) (out[t.tag_lan] ??= []).push(t.tag)
    return out
  }
  const build = (parentId: number): UserNavigationTreeDto[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order_position - b.order_position)
      .map(it => mapRowToDto(it, { tagTranslations: tagsFor(it.id_item), children: build(it.id_item), locale }))
  return build(rootId)
}

function descendantIds(items: NavigationItemRow[], id: number): Set<number> {
  const childrenByParent = new Map<number | null, number[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it.id_item)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const out = new Set<number>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of childrenByParent.get(cur) ?? []) {
      if (!out.has(c)) { out.add(c); stack.push(c) }
    }
  }
  return out
}

export function canDeleteSubtree(items: NavigationItemRow[], id: number): boolean {
  if (id === 0 || id === -1) return false
  const subtree = descendantIds(items, id)
  for (const it of items) {
    if (subtree.has(it.id_item) && it.is_immutable === 1) return false
  }
  return true
}

export function isDescendant(items: NavigationItemRow[], candidateId: number, ancestorId: number): boolean {
  return descendantIds(items, ancestorId).has(candidateId)
}

/**
 * Categories an item can be nested under (the Genitore choices, Root aside). Every category
 * qualifies, the immutable seeded sections (Home, Admin) included: being immutable only means
 * the row itself can't be renamed or deleted, not that it can't hold new items. Left out are
 * the virtual roots — Root is offered separately and Operations is not a placement target —
 * and any category hidden from the config UI.
 *
 * `excludeSubtreeOf` is the item being edited: it and its descendants are dropped, otherwise
 * a category could be nested into itself or into one of its own children (a cycle).
 */
export function selectableParents(items: NavigationItemRow[], excludeSubtreeOf?: number): ParentOption[] {
  const excluded = excludeSubtreeOf != null ? descendantIds(items, excludeSubtreeOf) : new Set<number>()
  return items
    .filter(i =>
      i.id_item_type === ITEM_TYPE_CATEGORY && i.id_item !== ROOT_ID && i.id_item !== OPERATIONS_ID
      && i.config_visibility !== 1 && !excluded.has(i.id_item))
    .map(i => ({
      id: i.id_item,
      name: i.item_translation?.[DEFAULT_LOCALE]?.name ?? i.name ?? '',
      navbarPosition: i.navbar_position,
    }))
}
