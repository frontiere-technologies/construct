import { describe, it, expect } from 'vitest'
import { buildAuthTree, buildAuthMap, applyToggle, computeDeltas } from './permission-tree'
import { buildNavTree } from './nav-tree-builder'
import type { NavigationItemRow, UserNavigationTreeDto } from './types'

const row = (id: number, parent: number | null, type: number, name: string): NavigationItemRow => ({
  id_item: id, name, id_item_type: type, id_functionality_type: type === 2 ? 3 : null,
  functionality_link: null, icon_path: null, id_item_parent: parent, order_position: id,
  navbar_position: null, item_translation: { EN: { name } }, is_immutable: 0,
  config_visibility: 0, no_permission_need_for_navigation: 0, open_in_new_tab: 1,
})

// root(0) > RBAC(2,cat) > Users(3,leaf), Funcs(4,leaf);  root(0) > Home(1,cat)
const items: NavigationItemRow[] = [
  row(0, null, 1, 'root'), row(1, 0, 1, 'Home'),
  row(2, 0, 1, 'RBAC'), row(3, 2, 2, 'Users'), row(4, 2, 2, 'Funcs'),
]

describe('buildAuthTree', () => {
  const trees = buildAuthTree(items, new Set([2, 3]), 0)
  it('builds children of the root, ordered, with authorization + label', () => {
    expect(trees.map(t => t.id)).toEqual([1, 2])
    const rbac = trees.find(t => t.id === 2)!
    expect(rbac.type).toBe('CATEGORY')
    expect(rbac.authorization).toBe(true)
    expect(rbac.children.map(c => c.id)).toEqual([3, 4])
    expect(rbac.children.find(c => c.id === 3)!.authorization).toBe(true)
    expect(rbac.children.find(c => c.id === 4)!.authorization).toBe(false)
    expect(rbac.name).toBe('RBAC')
  })

  // The permissions tree and the functionalities tree render through the same
  // NavigationTree, whose typeIcon() picks the per-kind icon from
  // functionalityType alone. buildAuthTree used to omit the field, so every
  // leaf on Roles & permissions fell to typeIcon's Circle fallback while the
  // same row showed its real icon on Functionalities.
  it('carries functionalityType so leaves keep their per-kind icon', () => {
    const rbac = trees.find(t => t.id === 2)!
    expect(rbac.children.find(c => c.id === 3)!.functionalityType).toBe('INTERNAL_FUNCTIONALITY')
  })

  it('agrees with buildNavTree on the icon-driving fields', () => {
    const navTrees = buildNavTree(items, new Map(), 0)
    const kindById = (ns: UserNavigationTreeDto[]): Record<number, string> => {
      const out: Record<number, string> = {}
      const walk = (list: UserNavigationTreeDto[]) => list.forEach(n => {
        out[n.id] = `${n.type}/${n.functionalityType ?? 'none'}`
        walk(n.children)
      })
      walk(ns)
      return out
    }
    expect(kindById(trees)).toEqual(kindById(navTrees))
  })
})

describe('buildAuthMap', () => {
  it('flattens authorization across all nodes', () => {
    const trees = buildAuthTree(items, new Set([2, 3]), 0)
    const map = buildAuthMap(trees)
    expect(map.get(2)).toBe(true)
    expect(map.get(3)).toBe(true)
    expect(map.get(4)).toBe(false)
    expect(map.get(1)).toBe(false)
  })
})

describe('applyToggle', () => {
  const trees = buildAuthTree(items, new Set(), 0)
  const base = buildAuthMap(trees)

  it('category ON sets it and all descendants', () => {
    const next = applyToggle(trees, base, 2, true)
    expect(next.get(2)).toBe(true)
    expect(next.get(3)).toBe(true)
    expect(next.get(4)).toBe(true)
  })
  it('category OFF clears it and all descendants', () => {
    const on = applyToggle(trees, base, 2, true)
    const off = applyToggle(trees, on, 2, false)
    expect(off.get(2)).toBe(false)
    expect(off.get(3)).toBe(false)
    expect(off.get(4)).toBe(false)
  })
  it('leaf ON auto-authorizes ancestor categories', () => {
    const next = applyToggle(trees, base, 3, true)
    expect(next.get(3)).toBe(true)
    expect(next.get(2)).toBe(true)   // ancestor
    expect(next.get(4)).toBe(false)  // sibling untouched
  })
  it('leaf OFF leaves ancestors untouched', () => {
    const on = applyToggle(trees, base, 3, true)   // 3 true, 2 true
    const off = applyToggle(trees, on, 3, false)
    expect(off.get(3)).toBe(false)
    expect(off.get(2)).toBe(true)    // ancestor stays
  })
  it('does not set the (out-of-tree) root id when walking ancestors', () => {
    const next = applyToggle(trees, base, 3, true)
    expect(next.has(0)).toBe(false)
  })
})

describe('computeDeltas', () => {
  it('returns only changed ids with their new value', () => {
    const loaded = new Map<number, boolean>([[2, true], [3, true], [4, false]])
    const current = new Map<number, boolean>([[2, true], [3, false], [4, true]])
    const deltas = computeDeltas(loaded, current).sort((a, b) => a.idItem - b.idItem)
    expect(deltas).toEqual([
      { idItem: 3, authorization: false },
      { idItem: 4, authorization: true },
    ])
  })
  it('no-op toggles produce no deltas', () => {
    const m = new Map<number, boolean>([[2, true]])
    expect(computeDeltas(m, new Map(m))).toEqual([])
  })
})
