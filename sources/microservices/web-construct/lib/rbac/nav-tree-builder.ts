import {
  type MenuEntryRow, type UserNavigationTreeDto, type Locale, type ParentOption,
  DEFAULT_LOCALE, FUNCTIONALITY_TYPE_BY_ID,
} from './types'
import { resolveNavigationText } from './navigation-locales'

export function mapRowToDto(
  it: MenuEntryRow,
  opts: { tagTranslations: Record<string, string[]>; children: UserNavigationTreeDto[]; locale?: Locale; fallbackLocale?: Locale },
): UserNavigationTreeDto {
  const locale = opts.locale ?? DEFAULT_LOCALE
  const fallbackLocale = opts.fallbackLocale ?? DEFAULT_LOCALE
  return {
    id: it.id_menu_entry,
    name: resolveNavigationText(it.item_translation, 'name', locale, fallbackLocale, it.name),
    // Un contenitore non ha una tipologia di funzionalità: è così che si distingue
    // una categoria da una funzionalità nell'albero del menu (Task 5).
    type: it.id_functionality_type === null ? 'CATEGORY' : 'FUNCTIONALITY',
    parentId: it.id_parent,
    authorization: false,
    description: resolveNavigationText(it.item_translation, 'description', locale, fallbackLocale, null) || null,
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

/**
 * The tree shown by the Funzionalità page — the menu tree, not the permission tree. There is
 * no virtual root id any more: a top-level entry has `id_parent` null, and that's the tree's
 * own root. `config_visibility` is gone too — rows that carried it were never carried over
 * into menu_entry by the Task 3 travaso, so there is nothing left to filter here.
 */
export function buildNavTree(
  items: MenuEntryRow[],
  tagsByItem: Map<number, { tag_lan: string; tag: string }[]>,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const childrenByParent = new Map<number | null, MenuEntryRow[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_parent) ?? []
    arr.push(it)
    childrenByParent.set(it.id_parent, arr)
  }
  const tagsFor = (id: number): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const t of tagsByItem.get(id) ?? []) (out[t.tag_lan] ??= []).push(t.tag)
    return out
  }
  const build = (parentId: number | null): UserNavigationTreeDto[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order_position - b.order_position)
      .map(it => mapRowToDto(it, { tagTranslations: tagsFor(it.id_menu_entry), children: build(it.id_menu_entry), locale, fallbackLocale }))
  return build(null)
}

/** `id` itself plus every descendant reachable through `id_parent`. */
export function descendantIds(items: MenuEntryRow[], id: number): Set<number> {
  const childrenByParent = new Map<number | null, number[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_parent) ?? []
    arr.push(it.id_menu_entry)
    childrenByParent.set(it.id_parent, arr)
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

export function canDeleteSubtree(items: MenuEntryRow[], id: number): boolean {
  const subtree = descendantIds(items, id)
  for (const it of items) {
    if (subtree.has(it.id_menu_entry) && it.is_immutable === 1) return false
  }
  return true
}

export function isDescendant(items: MenuEntryRow[], candidateId: number, ancestorId: number): boolean {
  return descendantIds(items, ancestorId).has(candidateId)
}

/**
 * Categories an item can be nested under (the Genitore choices, Root aside). Every category
 * qualifies, the immutable seeded sections (Home, Admin) included: being immutable only means
 * the row itself can't be renamed or deleted, not that it can't hold new items.
 *
 * `excludeSubtreeOf` is the item being edited: it and its descendants are dropped, otherwise
 * a category could be nested into itself or into one of its own children (a cycle).
 */
export function selectableParents(items: MenuEntryRow[], excludeSubtreeOf?: number): ParentOption[] {
  const excluded = excludeSubtreeOf != null ? descendantIds(items, excludeSubtreeOf) : new Set<number>()
  return items
    .filter(i => i.id_functionality_type === null && !excluded.has(i.id_menu_entry))
    .map(i => ({
      id: i.id_menu_entry,
      name: i.item_translation?.[DEFAULT_LOCALE]?.name ?? i.name ?? '',
      navbarPosition: i.navbar_position,
    }))
}
