import { describe, it, expect } from 'vitest'
import { buildNavTree, canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { NavigationItemRow } from './types'

const row = (id: number, parent: number | null, type: number, name: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  id_item: id, name, id_item_type: type, id_functionality_type: type === 2 ? 3 : null,
  functionality_link: type === 2 ? 'link-' + id : null, icon_path: null, id_item_parent: parent,
  order_position: id, navbar_position: null, item_translation: { EN: { name, description: 'd' + id } },
  is_immutable: 0, config_visibility: 0, no_permission_need_for_navigation: 0, ...extra,
})

// root(0) > A(2,cat,immutable) > A1(3,leaf); root(0) > B(4,cat) > B1(5,leaf); hidden(6,leaf,config_visibility=1)
const items: NavigationItemRow[] = [
  row(0, null, 1, 'root'), row(2, 0, 1, 'A', { is_immutable: 1 }), row(3, 2, 2, 'A1'),
  row(4, 0, 1, 'B'), row(5, 4, 2, 'B1'), row(6, 0, 2, 'hidden', { config_visibility: 1 }),
]
const tags = new Map<number, { tag_lan: string; tag: string }[]>([[5, [{ tag_lan: 'EN', tag: 'x' }, { tag_lan: 'EN', tag: 'y' }]]])

describe('buildNavTree', () => {
  const trees = buildNavTree(items, tags, 0)
  it('builds children of root, ordered, excluding config_visibility', () => {
    expect(trees.map(t => t.id)).toEqual([2, 4]) // 6 hidden
  })
  it('populates extended fields incl. functionalityType + tagTranslations', () => {
    const b1 = trees.find(t => t.id === 4)!.children.find(c => c.id === 5)!
    expect(b1.type).toBe('FUNCTIONALITY')
    expect(b1.functionalityType).toBe('INTERNAL_FUNCTIONALITY')
    expect(b1.link).toBe('link-5')
    expect(b1.tagTranslations).toEqual({ EN: ['x', 'y'] })
    expect(b1.isImmutable).toBe(false)
  })
  it('marks immutable nodes', () => {
    expect(trees.find(t => t.id === 2)!.isImmutable).toBe(true)
  })
})

describe('canDeleteSubtree', () => {
  it('blocks an immutable target', () => { expect(canDeleteSubtree(items, 2)).toBe(false) })
  it('blocks when a descendant is immutable', () => {
    // make A1 immutable, A mutable
    const mod = items.map(i => i.id_item === 2 ? { ...i, is_immutable: 0 } : i.id_item === 3 ? { ...i, is_immutable: 1 } : i)
    expect(canDeleteSubtree(mod, 2)).toBe(false)
  })
  it('allows a fully-deletable subtree', () => { expect(canDeleteSubtree(items, 4)).toBe(true) })
  it('blocks the virtual roots', () => {
    expect(canDeleteSubtree(items, 0)).toBe(false)
    expect(canDeleteSubtree(items, -1)).toBe(false)
  })
})

describe('isDescendant', () => {
  it('true when candidate is inside the ancestor subtree', () => { expect(isDescendant(items, 3, 2)).toBe(true) })
  it('false otherwise', () => { expect(isDescendant(items, 5, 2)).toBe(false) })
  it('treats the node itself as a descendant (cycle into self)', () => { expect(isDescendant(items, 2, 2)).toBe(true) })
})
