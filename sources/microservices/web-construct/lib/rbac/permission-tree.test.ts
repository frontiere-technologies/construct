import { describe, it, expect } from 'vitest'
import { buildAuthTree, buildAuthMap, computeDeltas, folderState, toggleNode, stampAuthorization } from './permission-tree'
import type { PermissionRow, UserNavigationTreeDto } from './types'

const perm = (over: Partial<PermissionRow> & { id_permission: number }): PermissionRow => ({
  kind: 'GRANT', code: `code-${over.id_permission}`, id_parent: null, order_position: 0,
  item_translation: null, description: null, deprecated_at: null, name: null, ...over,
})

describe('buildAuthTree', () => {
  it('costruisce un albero solo, senza radici speciali', () => {
    const tree = buildAuthTree([
      perm({ id_permission: 1, kind: 'CATEGORY', code: null }),
      perm({ id_permission: 2, id_parent: 1 }),
    ], new Set([2]))
    expect(tree).toHaveLength(1)
    expect(tree[0].children.map(c => c.id)).toEqual([2])
    expect(tree[0].children[0].authorization).toBe(true)
  })

  it('non concede mai una categoria: la concessione sta sulle foglie', () => {
    const tree = buildAuthTree([
      perm({ id_permission: 1, kind: 'CATEGORY', code: null }),
      perm({ id_permission: 2, id_parent: 1 }),
    ], new Set([2]))
    expect(tree[0].authorization).toBe(false)
  })

  // La stessa regola vale anche se il database porta ancora una riga residua in
  // role_permission per la categoria (HOLE-5, prima della migrazione 0020, o su un dataset
  // non ancora ripulito): grantedIds la contiene, ma l'albero la ignora comunque per kind.
  it('ignora una concessione residua sulla categoria, anche se presente fra gli id concessi', () => {
    const tree = buildAuthTree([
      perm({ id_permission: 1, kind: 'CATEGORY', code: null }),
      perm({ id_permission: 2, id_parent: 1 }),
    ], new Set([1, 2]))
    expect(tree[0].authorization).toBe(false)
    expect(tree[0].children[0].authorization).toBe(true)
  })

  it('esclude i permessi deprecati', () => {
    const tree = buildAuthTree([
      perm({ id_permission: 1, deprecated_at: '2026-01-01T00:00:00Z' }),
      perm({ id_permission: 2 }),
    ], new Set())
    expect(tree.map(n => n.id)).toEqual([2])
  })

  it('costruisce più radici quando più righe hanno id_parent nullo (root e operations restano due nodi dello stesso albero)', () => {
    const tree = buildAuthTree([
      perm({ id_permission: -1, kind: 'CATEGORY', code: null, name: 'operations' }),
      perm({ id_permission: 0, kind: 'CATEGORY', code: null, name: 'root' }),
      perm({ id_permission: 1, id_parent: 0 }),
      perm({ id_permission: 100, id_parent: -1 }),
    ], new Set([1, 100]))
    expect(tree.map(n => n.id).sort((a, b) => a - b)).toEqual([-1, 0])
    expect(tree.find(n => n.id === 0)!.children.map(c => c.id)).toEqual([1])
    expect(tree.find(n => n.id === -1)!.children.map(c => c.id)).toEqual([100])
  })

  it('ordina per order_position e usa la traduzione della locale, con ripiego su name', () => {
    const tree = buildAuthTree([
      perm({ id_permission: 1, order_position: 2, name: 'fallback' }),
      perm({ id_permission: 2, order_position: 1, item_translation: { IT: { name: 'Secondo' } } }),
    ], new Set(), 'IT')
    expect(tree.map(n => n.id)).toEqual([2, 1])
    expect(tree.find(n => n.id === 2)!.name).toBe('Secondo')
    expect(tree.find(n => n.id === 1)!.name).toBe('fallback')
  })
})

// root(0) > RBAC(2, categoria) > Users(3, foglia), Funcs(4, foglia);  root(0) > Home(1, categoria)
const items: PermissionRow[] = [
  perm({ id_permission: 0, kind: 'CATEGORY', code: null, name: 'root' }),
  perm({ id_permission: 1, kind: 'CATEGORY', code: null, name: 'Home', id_parent: 0 }),
  perm({ id_permission: 2, kind: 'CATEGORY', code: null, name: 'RBAC', id_parent: 0 }),
  perm({ id_permission: 3, name: 'Users', id_parent: 2 }),
  perm({ id_permission: 4, name: 'Funcs', id_parent: 2 }),
]

describe('buildAuthMap', () => {
  it('flattens authorization across all nodes', () => {
    const tree = buildAuthTree(items, new Set([3]))
    const map = buildAuthMap(tree)
    expect(map.get(2)).toBe(false) // categoria: mai concessa, nemmeno con figli concessi
    expect(map.get(3)).toBe(true)
    expect(map.get(4)).toBe(false)
    expect(map.get(1)).toBe(false)
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

// --- Task 2: cartelle a tre stati, e il clic che decide il verso da sé (DEC-20) ---

const nodo = (
  id: number,
  type: 'CATEGORY' | 'FUNCTIONALITY',
  children: UserNavigationTreeDto[] = [],
): UserNavigationTreeDto => ({
  id, name: `nodo-${id}`, type, parentId: null, authorization: false, children,
})

// Home(1) > Test2(2) > [Le scienze(3, foglia), AAA(4, contenitore vuoto)];  Admin(5) > [6, 7]
const menu: UserNavigationTreeDto[] = [
  nodo(1, 'CATEGORY', [nodo(2, 'CATEGORY', [nodo(3, 'FUNCTIONALITY'), nodo(4, 'CATEGORY')])]),
  nodo(5, 'CATEGORY', [nodo(6, 'FUNCTIONALITY'), nodo(7, 'FUNCTIONALITY')]),
]
const spento = new Map<number, boolean>()

describe('folderState', () => {
  it('dice «empty» su un contenitore senza foglie nel sottoalbero', () => {
    expect(folderState(menu[0].children[0].children[1], spento)).toBe('empty')
  })

  it('dice «off» quando nessuna foglia del sottoalbero è concessa', () => {
    expect(folderState(menu[1], spento)).toBe('off')
  })

  it('dice «partial» quando alcune sì e alcune no', () => {
    expect(folderState(menu[1], new Map([[6, true]]))).toBe('partial')
  })

  it('dice «on» quando tutte le foglie del sottoalbero sono concesse', () => {
    expect(folderState(menu[1], new Map([[6, true], [7, true]]))).toBe('on')
  })

  it('guarda le foglie annidate, non solo i figli diretti, e ignora i contenitori intermedi', () => {
    // Home(1) ha una sola foglia in tutto il sottoalbero: Le scienze(3), sotto Test2(2).
    // AAA(4) è un contenitore e non conta come foglia da concedere.
    expect(folderState(menu[0], new Map([[3, true]]))).toBe('on')
  })
})

describe('toggleNode', () => {
  it('su una foglia inverte solo se stessa', () => {
    const next = toggleNode(menu, new Map([[6, true]]), 6)
    expect(next.get(6)).toBe(false)
    // 7 non è mai stata nella mappa in ingresso: "inverte solo se stessa" vuol dire che resta
    // assente, non che diventi esplicitamente false (altrimenti toggleNode scriverebbe una
    // chiave che non le compete).
    expect(next.get(7)).toBeUndefined()
  })

  it('su una foglia spenta la accende, senza toccare gli antenati (HOLE-5)', () => {
    const next = toggleNode(menu, spento, 6)
    expect(next.get(6)).toBe(true)
    expect(next.get(5)).toBeUndefined()
  })

  // BUG-3: prima il verso lo calcolava il chiamante da `!(map.get(id) ?? false)`, e su una
  // cartella — sempre spenta per costruzione — valeva sempre true: accendeva e non spegneva mai.
  it('su una cartella spenta accende tutte le foglie del sottoalbero', () => {
    const next = toggleNode(menu, spento, 5)
    expect(next.get(6)).toBe(true)
    expect(next.get(7)).toBe(true)
  })

  it('su una cartella parziale accende tutto, non inverte foglia per foglia', () => {
    const next = toggleNode(menu, new Map([[6, true]]), 5)
    expect(next.get(6)).toBe(true)
    expect(next.get(7)).toBe(true)
  })

  it('su una cartella piena spegne tutte le foglie del sottoalbero', () => {
    const next = toggleNode(menu, new Map([[6, true], [7, true]]), 5)
    expect(next.get(6)).toBe(false)
    expect(next.get(7)).toBe(false)
  })

  it('non scrive mai la cartella stessa, in nessuno dei due versi', () => {
    const acceso = toggleNode(menu, spento, 5)
    expect(acceso.has(5)).toBe(false)
    const spentoDiNuovo = toggleNode(menu, acceso, 5)
    expect(spentoDiNuovo.has(5)).toBe(false)
  })

  it('scende oltre i contenitori intermedi', () => {
    const next = toggleNode(menu, spento, 1)
    expect(next.get(3)).toBe(true)
    expect(next.has(2)).toBe(false)
    expect(next.has(4)).toBe(false)
  })

  it('su un contenitore vuoto non cambia niente', () => {
    const next = toggleNode(menu, spento, 4)
    expect([...next.entries()]).toEqual([])
  })

  it('non modifica la mappa ricevuta', () => {
    const originale = new Map([[6, true]])
    toggleNode(menu, originale, 5)
    expect(originale.get(7)).toBeUndefined()
  })

  it('su un id sconosciuto restituisce una copia intatta', () => {
    const originale = new Map([[6, true]])
    const next = toggleNode(menu, originale, 9999)
    expect([...next.entries()]).toEqual([[6, true]])
    expect(next).not.toBe(originale)
  })
})

describe('stampAuthorization', () => {
  it('timbra la concessione sulle funzionalità e mai sui contenitori', () => {
    const stamped = stampAuthorization(menu, new Set([3, 6]))
    expect(stamped[0].children[0].children[0].authorization).toBe(true)
    expect(stamped[1].children[0].authorization).toBe(true)
    expect(stamped[1].children[1].authorization).toBe(false)
    expect(stamped[0].authorization).toBe(false)
  })

  // Il gemello del test che protegge buildAuthTree da una concessione residua su una
  // categoria: se il database portasse una riga su un contenitore, l'albero la ignora.
  it('ignora una concessione che puntasse a un contenitore', () => {
    const stamped = stampAuthorization(menu, new Set([5]))
    expect(stamped[1].authorization).toBe(false)
  })

  it('non modifica l\'albero ricevuto', () => {
    stampAuthorization(menu, new Set([6]))
    expect(menu[1].children[0].authorization).toBe(false)
  })

  it('conserva gli altri campi del nodo', () => {
    const stamped = stampAuthorization(menu, new Set([6]))
    expect(stamped[1].name).toBe('nodo-5')
    expect(stamped[1].children.map(c => c.id)).toEqual([6, 7])
  })
})
