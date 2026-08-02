import { describe, it, expect } from 'vitest'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import { FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
import type { NavigationItemRow, RoleItemRow } from './types'

const cat = (id: number, parent: number | null, name: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  id_item: id, name, id_item_type: 1, id_functionality_type: null, functionality_link: null,
  icon_path: null, id_item_parent: parent, order_position: 0, navbar_position: null,
  item_translation: { EN: { name } }, is_immutable: 0, config_visibility: 0,
  no_permission_need_for_navigation: 0, open_in_new_tab: 1, ...extra,
})
const fn = (id: number, parent: number | null, name: string, link: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  ...cat(id, parent, name, {}), id_item_type: 2, id_functionality_type: 3, functionality_link: link, ...extra,
})

describe('resolveAuthorizedItemIds', () => {
  const items: NavigationItemRow[] = [cat(0, null, 'root'), fn(3, 0, 'Users', 'user-management'), fn(9, 0, 'Secret', 'secret')]
  const roleItems: RoleItemRow[] = [
    { id_role: 5, id_item: 3, authorized: true },
    { id_role: 5, id_item: 9, authorized: false },
  ]
  it('includes items authorized for one of the user roles', () => {
    const ids = resolveAuthorizedItemIds(items, roleItems, [5])
    expect(ids.has(3)).toBe(true)
    expect(ids.has(9)).toBe(false)
  })
  it('always includes no_permission_need items', () => {
    const open = [fn(7, 0, 'Open', 'open', { no_permission_need_for_navigation: 1 })]
    const ids = resolveAuthorizedItemIds(open, [], [])
    expect(ids.has(7)).toBe(true)
  })
})

describe('mapNavigationToSidebar', () => {
  const items: NavigationItemRow[] = [
    cat(-1, null, 'operations'),
    cat(0, null, 'root'),
    cat(2, 0, 'RBAC', { item_translation: { EN: { name: 'RBAC' } } }),
    fn(3, 2, 'Users', 'user-management', { order_position: 0 }),
    fn(99, -1, 'USER_READ', '', { id_functionality_type: 5 }),
    cat(100, 99, 'deep ops child'),
    fn(50, 2, 'Hidden', 'hidden', { config_visibility: 1 }),
    fn(200, 2, 'Embed', 'https://example.com', { id_functionality_type: FUNCTYPE_EMBEDDED_PAGE }),
  ]
  const authorized = new Set([2, 3, 99, 100, 50, 200])
  const result = mapNavigationToSidebar(items, authorized)

  it('omits the root and operations virtual nodes', () => {
    expect(result.find(i => i.id === '0')).toBeUndefined()
    expect(result.find(i => i.id === '-1')).toBeUndefined()
  })
  it('omits items under operations / PERMISSION items', () => {
    expect(result.find(i => i.id === '99')).toBeUndefined()
  })
  it('maps a top-level category to parentId null + type container', () => {
    const rbac = result.find(i => i.id === '2')!
    expect(rbac.parentId).toBeNull()
    expect(rbac.type).toBe('container')
    expect(rbac.label).toBe('RBAC')
  })
  it('maps a functionality with normalized route + parent', () => {
    const users = result.find(i => i.id === '3')!
    expect(users.type).toBe('link')
    expect(users.route).toBe('/user-management')
    expect(users.parentId).toBe('2')
  })
  it('deeply-nested operations item is excluded', () => {
    expect(result.find(i => i.id === '100')).toBeUndefined()
  })
  it('config_visibility item is excluded', () => {
    expect(result.find(i => i.id === '50')).toBeUndefined()
  })
  it('reveals the parent container of an authorized leaf that has no grant of its own', () => {
    // authorize a leaf (3, parent 2) but NOT its parent category (2)
    const result2 = mapNavigationToSidebar(items, new Set([3]))
    expect(result2.find(i => i.id === '2')?.type).toBe('container')
    expect(result2.find(i => i.id === '3')?.parentId).toBe('2')
  })
  it('routes an EMBEDDED_PAGE item to the internal /embedded/{id} route', () => {
    const embed = result.find(i => i.id === '200')!
    expect(embed.route).toBe('/embedded/200')
  })

  it('uses the configured default language before the legacy English fallback', () => {
    const localized = fn(300, 0, 'database name', 'localized', {
      item_translation: { IT: { name: 'Italiano' }, EN: { name: 'English' } },
    })
    const [menuItem] = mapNavigationToSidebar([cat(0, null, 'root'), localized], new Set([300]), 'DE', 'IT')
    expect(menuItem.label).toBe('Italiano')
  })
})

describe('mapNavigationToSidebar external-link target', () => {
  const ext = (id: number, openInNewTab: number) =>
    fn(id, 0, `ext${id}`, 'https://example.com', { id_functionality_type: FUNCTYPE_EXTERNAL_LINK, open_in_new_tab: openInNewTab })

  it('opens an external link in a new tab when the flag is set', () => {
    const [item] = mapNavigationToSidebar([cat(0, null, 'root'), ext(10, 1)], new Set([10]))
    expect(item.target).toBe('_blank')
  })

  it('opens an external link in the same tab when the flag is cleared', () => {
    const [item] = mapNavigationToSidebar([cat(0, null, 'root'), ext(11, 0)], new Set([11]))
    expect(item.target).toBe('_self')
  })

  it('leaves the target unset for kinds the flag does not apply to', () => {
    const items: NavigationItemRow[] = [
      cat(0, null, 'root'),
      fn(12, 0, 'internal', 'user-management', { open_in_new_tab: 1 }),
      fn(13, 0, 'embedded', 'https://example.com', { id_functionality_type: FUNCTYPE_EMBEDDED_PAGE, open_in_new_tab: 1 }),
      cat(14, 0, 'section', { open_in_new_tab: 1 }),
    ]
    const menu = mapNavigationToSidebar(items, new Set([12, 13, 14]))
    expect(menu.map(m => m.target)).toEqual([undefined, undefined, undefined])
  })
})

describe('mapNavigationToSidebar container visibility', () => {
  // The reported case: Admin(6, granted) > aaa(526, never granted) > link-interno 2(460, granted).
  // Categories are only granted implicitly, when Roles & Permissions toggles a functionality
  // under them — so a section an already-authorized item was *moved* into has no grant at all.
  const nested: NavigationItemRow[] = [
    cat(0, null, 'root'), cat(6, 0, 'Admin', { is_immutable: 1 }),
    cat(526, 6, 'aaa'), fn(460, 526, 'link-interno 2', 'interno-2'),
  ]

  it('shows a section holding an authorized item even when the section itself was never granted', () => {
    const r = mapNavigationToSidebar(nested, new Set([6, 460]))
    expect(r.map(i => i.id)).toEqual(['6', '526', '460'])
    expect(r.find(i => i.id === '526')!.type).toBe('container')
    expect(r.find(i => i.id === '460')!.parentId).toBe('526')
  })

  it('reveals every ungranted ancestor of an authorized item, however deep', () => {
    const deep = [...nested, cat(600, 526, 'inner'), fn(601, 600, 'deep link', 'deep')]
    const r = mapNavigationToSidebar(deep, new Set([601]))
    // 6/526/600 are revealed as ancestors; the ungranted sibling leaf 460 stays hidden
    expect(r.map(i => i.id).sort()).toEqual(['526', '6', '600', '601'].sort())
  })

  it('keeps hiding a section with nothing authorized inside it', () => {
    expect(mapNavigationToSidebar(nested, new Set([6])).map(i => i.id)).toEqual(['6'])
  })

  it('still drops an authorized item whose parent is hidden from navigation', () => {
    const hidden: NavigationItemRow[] = [
      cat(0, null, 'root'), cat(2, 0, 'Hidden', { config_visibility: 1 }), fn(3, 2, 'Users', 'user-management'),
    ]
    expect(mapNavigationToSidebar(hidden, new Set([2, 3]))).toEqual([])
  })

  it('never reveals a container through an item under operations', () => {
    const ops: NavigationItemRow[] = [
      cat(-1, null, 'operations'), cat(700, -1, 'ops section'), fn(701, 700, 'PERM', '', { id_functionality_type: 5 }),
    ]
    expect(mapNavigationToSidebar(ops, new Set([700, 701]))).toEqual([])
  })
})
