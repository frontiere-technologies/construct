import { describe, it, expect } from 'vitest'
import { mapMenuToSidebar, resolveGrantedPermissionIds } from './sidebar-adapter'
import type { MenuEntryRow } from './types'

const voce = (over: Partial<MenuEntryRow> & { id_menu_entry: number }): MenuEntryRow => ({
  id_permission: null, id_parent: null, name: `voce-${over.id_menu_entry}`,
  order_position: 0, navbar_position: null, icon_path: null,
  id_functionality_type: 1, functionality_link: null, open_in_new_tab: 1,
  item_translation: null, is_immutable: 0, ...over,
})

describe('mapMenuToSidebar', () => {
  it('mostra la voce pubblica anche senza nessuna concessione', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 7, id_permission: null })], new Set())
    expect(out.map(m => m.id)).toEqual(['7'])
  })

  it('nasconde la voce il cui permesso non è concesso', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8, id_permission: 42 })], new Set())
    expect(out).toEqual([])
  })

  it('mostra la voce il cui permesso è concesso', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8, id_permission: 42 })], new Set([42]))
    expect(out.map(m => m.id)).toEqual(['8'])
  })

  // La categoria è un contenitore del proprio albero: si mostra se contiene qualcosa di
  // visibile. Non serve più cercare concessioni sui genitori, perché i genitori non sono
  // permessi — la risalita che li rivela resta, solo non controlla più niente su di loro.
  it('mostra la categoria che contiene una voce visibile, e non quella vuota', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_permission: null, id_functionality_type: null }),
      voce({ id_menu_entry: 2, id_permission: 42, id_parent: 1 }),
      voce({ id_menu_entry: 3, id_permission: null, id_functionality_type: null }),
      voce({ id_menu_entry: 4, id_permission: 99, id_parent: 3 }),
    ], new Set([42]))
    expect(out.map(m => m.id).sort()).toEqual(['1', '2'])
  })

  it('due voci sullo stesso permesso si mostrano entrambe', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 10, id_permission: 42 }),
      voce({ id_menu_entry: 11, id_permission: 42 }),
    ], new Set([42]))
    expect(out.map(m => m.id).sort()).toEqual(['10', '11'])
  })

  it('rivela ogni antenato di una voce concessa, per quanto profondo, senza concessioni proprie', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_permission: null, id_functionality_type: null, name: 'Admin' }),
      voce({ id_menu_entry: 2, id_permission: null, id_functionality_type: null, id_parent: 1, name: 'aaa' }),
      voce({ id_menu_entry: 3, id_permission: 460, id_parent: 2, name: 'link-interno' }),
    ], new Set([460]))
    expect(out.map(m => m.id).sort()).toEqual(['1', '2', '3'])
  })

  it('applica route /embedded/{id} e target sul link esterno', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 20, id_functionality_type: 1, functionality_link: null }),
      voce({ id_menu_entry: 21, id_functionality_type: 2, functionality_link: 'https://example.com', open_in_new_tab: 0 }),
    ], new Set())
    expect(out.find(m => m.id === '20')?.route).toBe('/embedded/20')
    expect(out.find(m => m.id === '21')?.target).toBe('_self')
  })

  it('usa la lingua configurata prima del fallback inglese', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 30, name: 'English', item_translation: { IT: { name: 'Italiano' }, EN: { name: 'English' } } }),
    ], new Set(), 'DE', 'IT')
    expect(out[0].label).toBe('Italiano')
  })
})

describe('resolveGrantedPermissionIds', () => {
  it('tiene solo le concessioni dei ruoli dell\'utente', () => {
    const granted = resolveGrantedPermissionIds(
      [{ id_role: 1, id_permission: 10 }, { id_role: 2, id_permission: 20 }],
      [1],
    )
    expect([...granted]).toEqual([10])
  })
})
