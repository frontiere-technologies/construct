import { describe, it, expect } from 'vitest'
import { activeAncestorIds, activeAncestorPath, navHighlight, togglePathAt } from './sidebar-highlight'
import type { MenuItem } from '@/types/menu'

const container = (id: string, parentId: string | null): MenuItem => ({
  id, label: id, type: 'container', parentId, order: 0, visible: true, active: true, position: 'main',
})
const link = (id: string, parentId: string | null, route: string): MenuItem => ({
  ...container(id, parentId), type: 'link', route,
})

// Admin(6) > Users(3, /user-management); Admin(6) > aaa(526) > link-interno 2(460, /interno-2)
const items: MenuItem[] = [
  container('6', null), link('3', '6', '/user-management'),
  container('526', '6'), link('460', '526', '/interno-2'),
]

describe('activeAncestorIds', () => {
  it('collects every container between the active route and the top level', () => {
    expect(activeAncestorIds(items, '460')).toEqual(new Set(['526', '6']))
  })
  it('collects the single parent of a first-level route', () => {
    expect(activeAncestorIds(items, '3')).toEqual(new Set(['6']))
  })
  it('is empty when no menu route is active', () => {
    expect(activeAncestorIds(items, null)).toEqual(new Set())
  })
  it('survives a parent that is missing from the menu', () => {
    expect(activeAncestorIds([link('9', 'gone', '/x')], '9')).toEqual(new Set())
  })
})

// Admin(6) > bbb(700) > aaa(526) > deep(800, /deep) — four levels, the reported case
const deepItems: MenuItem[] = [
  container('6', null), container('700', '6'), container('526', '700'), link('800', '526', '/deep'),
]

describe('activeAncestorPath', () => {
  it('returns the containers top level first, however deep the route sits', () => {
    expect(activeAncestorPath(deepItems, '800')).toEqual(['6', '700', '526'])
  })
  it('returns a single container for a first-level route', () => {
    expect(activeAncestorPath(items, '3')).toEqual(['6'])
  })
  it('returns nothing when no menu route is active', () => {
    expect(activeAncestorPath(deepItems, null)).toEqual([])
  })
  it('stops at a parent that is missing from the menu instead of looping', () => {
    expect(activeAncestorPath([link('9', 'gone', '/x')], '9')).toEqual([])
  })
  it('agrees with activeAncestorIds', () => {
    expect(new Set(activeAncestorPath(deepItems, '800'))).toEqual(activeAncestorIds(deepItems, '800'))
  })
})

describe('togglePathAt', () => {
  it('opens a top-level container, replacing any other chain', () => {
    expect(togglePathAt([], 0, '6')).toEqual(['6'])
    expect(togglePathAt(['6', '700', '526'], 0, 'other')).toEqual(['other'])
  })

  it('appends the next level, with no ceiling on depth', () => {
    let path = togglePathAt([], 0, '6')
    path = togglePathAt(path, 1, '700')
    path = togglePathAt(path, 2, '526')
    path = togglePathAt(path, 3, '900')
    expect(path).toEqual(['6', '700', '526', '900'])
  })

  it('closes the container when it is already the one open at that depth', () => {
    expect(togglePathAt(['6', '700', '526'], 2, '526')).toEqual(['6', '700'])
    expect(togglePathAt(['6'], 0, '6')).toEqual([])
  })

  it('replaces a sibling at the same depth and drops everything below it', () => {
    expect(togglePathAt(['6', '700', '526'], 1, 'ccc')).toEqual(['6', 'ccc'])
  })
})

describe('navHighlight', () => {
  const ctx = (activeRouteId: string | null, openIds: string[]) => ({
    activeRouteId,
    activeAncestors: activeAncestorIds(items, activeRouteId),
    openIds: new Set(openIds),
  })

  it('marks the current page active', () => {
    expect(navHighlight(items[1], ctx('3', ['6']))).toBe('active')
  })

  it('marks a container holding the current page active, at any level', () => {
    // on /interno-2 both Admin (level 1) and aaa (level 2) hold the current page
    const c = ctx('460', ['6', '526'])
    expect(navHighlight(items[0], c)).toBe('active')
    expect(navHighlight(items[2], c)).toBe('active')
  })

  it('marks a merely-open container open, not active — the reported case', () => {
    // on /user-management with the aaa panel open, aaa must not look like the active Users link
    const c = ctx('3', ['6', '526'])
    expect(navHighlight(items[1], c)).toBe('active')  // Users — the page you're on
    expect(navHighlight(items[0], c)).toBe('active')  // Admin — holds that page
    expect(navHighlight(items[2], c)).toBe('open')    // aaa — just an open panel
  })

  it('applies the open rule identically at level 1 and level 2', () => {
    // nothing active: an open container is 'open' whichever column it sits in
    const c = ctx(null, ['6', '526'])
    expect(navHighlight(items[0], c)).toBe('open')
    expect(navHighlight(items[2], c)).toBe('open')
  })

  it('leaves closed containers and other links unhighlighted', () => {
    const c = ctx('3', ['6'])
    expect(navHighlight(items[2], c)).toBe('none')
    expect(navHighlight(items[3], c)).toBe('none')
  })

  it('never marks a link open, even if something shares its id in openIds', () => {
    expect(navHighlight(items[3], ctx(null, ['460']))).toBe('none')
  })
})
