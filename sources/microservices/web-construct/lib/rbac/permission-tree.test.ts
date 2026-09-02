import { describe, it, expect } from 'vitest'
import { buildAuthTree, buildAuthMap, applyToggle, computeDeltas } from './permission-tree'
import type { PermissionRow } from './types'

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

describe('applyToggle', () => {
  const tree = buildAuthTree(items, new Set())
  const base = buildAuthMap(tree)

  it('category ON accende solo le foglie GRANT del sottoalbero, mai la categoria stessa', () => {
    const next = applyToggle(tree, base, 2, true)
    expect(next.get(3)).toBe(true)
    expect(next.get(4)).toBe(true)
    expect(next.get(2)).toBe(false) // la categoria non riceve mai una concessione (spec 3.3)
  })

  it('category OFF spegne tutte le foglie GRANT del sottoalbero', () => {
    const on = applyToggle(tree, base, 2, true)
    const off = applyToggle(tree, on, 2, false)
    expect(off.get(3)).toBe(false)
    expect(off.get(4)).toBe(false)
    expect(off.get(2)).toBe(false)
  })

  it('leaf ON accende solo se stessa: nessun antenato viene marcato concesso (HOLE-5)', () => {
    const next = applyToggle(tree, base, 3, true)
    expect(next.get(3)).toBe(true)
    expect(next.get(2)).toBe(false) // antenato: MAI più risalito
    expect(next.get(4)).toBe(false) // fratello non toccato
  })

  it('leaf OFF non ha antenati da revocare: non ce n\'erano da propagare all\'accensione', () => {
    const on = applyToggle(tree, base, 3, true)
    const off = applyToggle(tree, on, 3, false)
    expect(off.get(3)).toBe(false)
    expect(off.get(2)).toBe(false)
  })

  it('leaf ON does not touch the tree root either, not just its direct category parent', () => {
    const next = applyToggle(tree, base, 3, true)
    expect(next.get(0)).toBe(false)
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
