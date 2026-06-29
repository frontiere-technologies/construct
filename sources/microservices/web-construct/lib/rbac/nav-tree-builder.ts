import {
  type NavigationItemRow, type UserNavigationTreeDto, type Locale,
  DEFAULT_LOCALE, ITEM_TYPE_CATEGORY, FUNCTIONALITY_TYPE_BY_ID,
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
