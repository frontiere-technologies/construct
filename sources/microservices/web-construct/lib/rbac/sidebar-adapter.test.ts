import { describe, it, expect } from 'vitest'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { NavigationItemRow, RoleItemRow } from './types'

const cat = (id: number, parent: number | null, name: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  id_item: id, name, id_item_type: 1, id_functionality_type: null, functionality_link: null,
  icon_path: null, id_item_parent: parent, order_position: 0, navbar_position: null,
  item_translation: { EN: { name } }, is_immutable: 0, config_visibility: 0,
  no_permission_need_for_navigation: 0, ...extra,
})
const fn = (id: number, parent: number | null, name: string, link: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  ...cat(id, parent, name, extra), id_item_type: 2, id_functionality_type: 3, functionality_link: link,
})

describe('resolveAuthorizedItemIds', () => {
  const items: NavigationItemRow[] = [cat(0, null, 'root'), fn(3, 0, 'Users', 'userManagement'), fn(9, 0, 'Secret', 'secret')]
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
    fn(3, 2, 'Users', 'userManagement', { order_position: 0 }),
    fn(99, -1, 'USER_READ', '', { id_functionality_type: 5 }),
    cat(100, 99, 'deep ops child'),
    fn(50, 2, 'Hidden', 'hidden', { config_visibility: 1 }),
  ]
  const authorized = new Set([2, 3, 99, 100, 50])
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
    expect(users.route).toBe('/userManagement')
    expect(users.parentId).toBe('2')
  })
  it('deeply-nested operations item is excluded', () => {
    expect(result.find(i => i.id === '100')).toBeUndefined()
  })
  it('config_visibility item is excluded', () => {
    expect(result.find(i => i.id === '50')).toBeUndefined()
  })
})
