import { describe, it, expect } from 'vitest'
import { mapMenuToSidebar, resolveGrantedFunctionalityIds } from './sidebar-adapter'
import { FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
import type { MenuEntryRow } from './types'

const voce = (over: Partial<MenuEntryRow> & { id_menu_entry: number }): MenuEntryRow => ({
  id_permission: null, id_parent: null, name: `voce-${over.id_menu_entry}`,
  order_position: 0, navbar_position: null, icon_path: null,
  id_functionality_type: 1, functionality_link: null, open_in_new_tab: 1,
  item_translation: null, is_immutable: 0, ...over,
})

describe('mapMenuToSidebar', () => {
  it('mostra una voce concessa al ruolo', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8 })], new Set([8]))
    expect(out).toHaveLength(1)
  })

  it('nasconde una voce non concessa: non esistono più voci pubbliche (DEC-18)', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8 })], new Set())
    expect(out).toEqual([])
  })

  it('un contenitore si mostra solo se contiene qualcosa di visibile', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_functionality_type: null, name: 'Home' }),
      voce({ id_menu_entry: 2, id_functionality_type: null, id_parent: 1, name: 'sezione vuota' }),
      voce({ id_menu_entry: 3, id_parent: 1, name: 'foglia' }),
    ], new Set([3]))
    expect(out.map(m => m.id)).toEqual(['1', '3'])
  })

  it('due voci concesse separatamente si mostrano entrambe', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 10 }),
      voce({ id_menu_entry: 11 }),
    ], new Set([10, 11]))
    expect(out.map(m => m.id).sort()).toEqual(['10', '11'])
  })

  it('rivela ogni antenato di una voce concessa, per quanto profondo, senza concessioni proprie', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_functionality_type: null, name: 'Admin' }),
      voce({ id_menu_entry: 2, id_functionality_type: null, id_parent: 1, name: 'aaa' }),
      voce({ id_menu_entry: 3, id_parent: 2, name: 'link-interno' }),
    ], new Set([3]))
    expect(out.map(m => m.id).sort()).toEqual(['1', '2', '3'])
  })

  it('applica route /embedded/{id} e target sul link esterno', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 20, id_functionality_type: 1, functionality_link: null }),
      voce({ id_menu_entry: 21, id_functionality_type: 2, functionality_link: 'https://example.com', open_in_new_tab: 0 }),
    ], new Set([20, 21]))
    expect(out.find(m => m.id === '20')?.route).toBe('/embedded/20')
    expect(out.find(m => m.id === '21')?.target).toBe('_self')
  })

  it('usa la lingua configurata prima del fallback inglese', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 30, name: 'English', item_translation: { IT: { name: 'Italiano' }, EN: { name: 'English' } } }),
    ], new Set([30]), 'DE', 'IT')
    expect(out[0].label).toBe('Italiano')
  })

  it('antepone "/" a un collegamento che non inizia né con "/" né con "http"', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 40, id_functionality_type: 3, functionality_link: 'user-management' }),
    ], new Set([40]))
    expect(out[0].route).toBe('/user-management')
  })

  it('imposta type contenitore, richiudibile e genitore nullo per una categoria di primo livello', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 70, id_functionality_type: null, name: 'RBAC' }),
      voce({ id_menu_entry: 71, id_parent: 70 }),
    ], new Set([71]))
    const container = out.find(m => m.id === '70')!
    expect(container.type).toBe('container')
    expect(container.collapsible).toBe(true)
    expect(container.parentId).toBeNull()
  })

  // Scelta deliberata, non una regressione: un contenitore non è mai concedibile — il ciclo
  // di resolveVisibleIds lo salta al primo controllo (isContainer) prima ancora di guardare
  // isEntryVisible — quindi anche se il suo stesso id comparisse fra le concessioni (qui: 1
  // nel Set) non basterebbe a mostrarlo. Solo la risalita da un figlio visibile lo rivela.
  it('nasconde il contenitore anche se il suo id compare fra le concessioni, senza figli visibili', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_functionality_type: null, name: 'Home' }),
      voce({ id_menu_entry: 2, id_functionality_type: null, id_parent: 1, name: 'sezione vuota' }),
    ], new Set([1]))
    expect(out).toEqual([])
  })
})

describe('mapMenuToSidebar target del collegamento', () => {
  it('apre in una nuova scheda per default un link esterno', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 50, id_functionality_type: FUNCTYPE_EXTERNAL_LINK, functionality_link: 'https://example.com', open_in_new_tab: 1 }),
    ], new Set([50]))
    expect(out[0].target).toBe('_blank')
  })

  it('non imposta un target per un collegamento interno, una pagina incorporata o un contenitore', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 60, id_functionality_type: 3, functionality_link: 'user-management', open_in_new_tab: 1 }),
      voce({ id_menu_entry: 61, id_functionality_type: FUNCTYPE_EMBEDDED_PAGE, open_in_new_tab: 1 }),
      voce({ id_menu_entry: 62, id_functionality_type: null, open_in_new_tab: 1, name: 'section' }),
      voce({ id_menu_entry: 63, id_parent: 62 }),
    ], new Set([60, 61, 63]))
    const targets = out.filter(m => ['60', '61', '62'].includes(m.id)).map(m => m.target)
    expect(targets).toEqual([undefined, undefined, undefined])
  })
})

describe('resolveGrantedFunctionalityIds', () => {
  it('tiene solo le righe dei ruoli richiesti', () => {
    const ids = resolveGrantedFunctionalityIds(
      [{ id_role: 1, id_menu_entry: 10 }, { id_role: 2, id_menu_entry: 20 }],
      [1],
    )
    expect([...ids]).toEqual([10])
  })
})
