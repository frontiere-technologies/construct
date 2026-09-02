import { describe, it, expect } from 'vitest'
import { mapMenuToSidebar, resolveGrantedPermissionIds } from './sidebar-adapter'
import { FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
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

  it('antepone "/" a un collegamento che non inizia né con "/" né con "http"', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 40, id_functionality_type: 3, functionality_link: 'user-management' }),
    ], new Set())
    expect(out[0].route).toBe('/user-management')
  })

  it('imposta type contenitore, richiudibile e genitore nullo per una categoria di primo livello', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 70, id_functionality_type: null, name: 'RBAC' }),
      voce({ id_menu_entry: 71, id_permission: 88, id_parent: 70 }),
    ], new Set([88]))
    const container = out.find(m => m.id === '70')!
    expect(container.type).toBe('container')
    expect(container.collapsible).toBe(true)
    expect(container.parentId).toBeNull()
  })

  // Scelta deliberata, non una regressione: nel travaso id_permission è sempre nullo su ogni
  // riga di tipo categoria (0017_menu_entry.sql), quindi un contenitore non ha mai un permesso
  // proprio da concedere. Anche se lo avesse — il tipo lo permette — il ciclo qui sopra lo
  // salta comunque per primo controllo (isContainer), e lo rivela solo per risalita da un
  // figlio visibile. Rimpiazza `keeps hiding a section with nothing authorized inside it` del
  // vecchio sidebar-adapter.test.ts: quel test valeva sul modello dove categoria e permesso
  // erano la stessa riga, e lì il proprio "authorized" della categoria non contava comunque
  // (vedi report del Task 4 per il confronto riga per riga con la vecchia resolveVisibleIds).
  it('nasconde il contenitore con un permesso proprio concesso ma senza figli visibili', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_permission: 42, id_functionality_type: null, name: 'Home' }),
      voce({ id_menu_entry: 2, id_permission: null, id_functionality_type: null, id_parent: 1, name: 'sezione vuota' }),
    ], new Set([42]))
    expect(out).toEqual([])
  })
})

describe('mapMenuToSidebar target del collegamento', () => {
  it('apre in una nuova scheda per default un link esterno', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 50, id_functionality_type: FUNCTYPE_EXTERNAL_LINK, functionality_link: 'https://example.com', open_in_new_tab: 1 }),
    ], new Set())
    expect(out[0].target).toBe('_blank')
  })

  it('non imposta un target per un collegamento interno, una pagina incorporata o un contenitore', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 60, id_functionality_type: 3, functionality_link: 'user-management', open_in_new_tab: 1 }),
      voce({ id_menu_entry: 61, id_functionality_type: FUNCTYPE_EMBEDDED_PAGE, open_in_new_tab: 1 }),
      voce({ id_menu_entry: 62, id_functionality_type: null, open_in_new_tab: 1, name: 'section' }),
      voce({ id_menu_entry: 63, id_permission: 77, id_parent: 62 }),
    ], new Set([77]))
    const targets = out.filter(m => ['60', '61', '62'].includes(m.id)).map(m => m.target)
    expect(targets).toEqual([undefined, undefined, undefined])
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
