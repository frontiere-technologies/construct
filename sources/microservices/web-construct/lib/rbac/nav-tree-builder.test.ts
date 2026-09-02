import { describe, it, expect } from 'vitest'
import { buildNavTree, canDeleteSubtree, isDescendant, selectableParents } from './nav-tree-builder'
import type { MenuEntryRow } from './types'

const row = (id: number, parent: number | null, isCategory: boolean, name: string, extra: Partial<MenuEntryRow> = {}): MenuEntryRow => ({
  id_menu_entry: id, id_permission: isCategory ? null : id, id_parent: parent, name,
  order_position: id, navbar_position: null, icon_path: null,
  id_functionality_type: isCategory ? null : 3,
  functionality_link: isCategory ? null : 'link-' + id,
  open_in_new_tab: 1, item_translation: { EN: { name, description: 'd' + id } }, is_immutable: 0, ...extra,
})

// A(2,cat,immutable) > A1(3,leaf); B(4,cat) > B1(5,leaf) — both A and B are top-level
// (id_parent nullo): there is no virtual root row to seed the tree from any more.
const items: MenuEntryRow[] = [
  row(2, null, true, 'A', { is_immutable: 1 }), row(3, 2, false, 'A1'),
  row(4, null, true, 'B'), row(5, 4, false, 'B1'),
]
const tags = new Map<number, { tag_lan: string; tag: string }[]>([[5, [{ tag_lan: 'EN', tag: 'x' }, { tag_lan: 'EN', tag: 'y' }]]])

describe('buildNavTree', () => {
  const trees = buildNavTree(items, tags)
  it('builds the children of the menu root (id_parent nullo), ordered', () => {
    expect(trees.map(t => t.id)).toEqual([2, 4])
  })
  it('populates extended fields incl. functionalityType + tagTranslations', () => {
    const b1 = trees.find(t => t.id === 4)!.children.find(c => c.id === 5)!
    expect(b1.type).toBe('FUNCTIONALITY')
    expect(b1.functionalityType).toBe('INTERNAL_FUNCTIONALITY')
    expect(b1.link).toBe('link-5')
    expect(b1.tagTranslations).toEqual({ EN: ['x', 'y'] })
    expect(b1.isImmutable).toBe(false)
    expect(b1.authorization).toBe(false)
  })
  it('marks immutable nodes', () => {
    expect(trees.find(t => t.id === 2)!.isImmutable).toBe(true)
  })
  it('derives CATEGORY from a null id_functionality_type, not from an item-type column', () => {
    expect(trees.find(t => t.id === 2)!.type).toBe('CATEGORY')
  })
})

describe('canDeleteSubtree', () => {
  it('blocks an immutable target', () => { expect(canDeleteSubtree(items, 2)).toBe(false) })
  it('blocks when a descendant is immutable', () => {
    // make A mutable, A1 immutable
    const mod = items.map(i => i.id_menu_entry === 2 ? { ...i, is_immutable: 0 } : i.id_menu_entry === 3 ? { ...i, is_immutable: 1 } : i)
    expect(canDeleteSubtree(mod, 2)).toBe(false)
  })
  it('allows a fully-deletable subtree', () => { expect(canDeleteSubtree(items, 4)).toBe(true) })
})

describe('isDescendant', () => {
  it('true when candidate is inside the ancestor subtree', () => { expect(isDescendant(items, 3, 2)).toBe(true) })
  it('false otherwise', () => { expect(isDescendant(items, 5, 2)).toBe(false) })
  it('treats the node itself as a descendant (cycle into self)', () => { expect(isDescendant(items, 2, 2)).toBe(true) })
})

// Reports(10) > Weekly(11) > Deep(12); Home(13,immutable cat); Leaf(14,functionality) — all
// top-level nodes have id_parent nullo, Reports/Home/Leaf included.
const catItems: MenuEntryRow[] = [
  row(10, null, true, 'Reports'), row(11, 10, true, 'Weekly'), row(12, 11, true, 'Deep'),
  row(13, null, true, 'Home', { is_immutable: 1, navbar_position: 'TOP' }), row(14, null, false, 'Leaf'),
]
// selectableParents also reports navbar_position, which is what orders the Genitore dropdown
const allCats = [
  { id: 10, name: 'Reports', navbarPosition: null }, { id: 11, name: 'Weekly', navbarPosition: null },
  { id: 12, name: 'Deep', navbarPosition: null }, { id: 13, name: 'Home', navbarPosition: 'TOP' },
]

describe('selectableParents', () => {
  it('keeps every category, including the immutable seeded ones (Home, Admin)', () => {
    // New items may be placed under Home/Admin even though those rows can't be edited
    expect(selectableParents(catItems)).toEqual(allCats)
  })

  it('leaves out functionalities — there is no virtual root row to leave out any more', () => {
    const ids = selectableParents(catItems).map(p => p.id)
    expect(ids).not.toContain(14)
  })

  it('excludes the item itself and its whole subtree, so a category cannot be nested in itself', () => {
    expect(selectableParents(catItems, 10)).toEqual([{ id: 13, name: 'Home', navbarPosition: 'TOP' }])
    expect(selectableParents(catItems, 11)).toEqual([
      { id: 10, name: 'Reports', navbarPosition: null }, { id: 13, name: 'Home', navbarPosition: 'TOP' },
    ])
  })

  it('excludes nothing but the item itself when it has no children', () => {
    expect(selectableParents(catItems, 14)).toEqual(allCats)
  })

  it('falls back to the raw name when the default locale has no translation', () => {
    const untranslated = [row(20, null, true, 'Raw', { item_translation: null })]
    expect(selectableParents(untranslated)).toEqual([{ id: 20, name: 'Raw', navbarPosition: null }])
  })
})
