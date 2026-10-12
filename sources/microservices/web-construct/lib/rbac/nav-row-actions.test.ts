import { describe, it, expect } from 'vitest'
import { childCountById, rowActions } from './nav-row-actions'
import type { UserNavigationTreeDto } from './types'

describe('rowActions', () => {
  it('lets any category take a new child, immutable ones included', () => {
    // Home and Admin are seeded immutable categories: they can hold new items even
    // though they cannot themselves be renamed or deleted.
    expect(rowActions({ type: 'CATEGORY', isImmutable: true }, true)).toEqual({ add: true, edit: false, remove: false })
  })

  it('gives a user-created category all three actions', () => {
    expect(rowActions({ type: 'CATEGORY', isImmutable: false }, true)).toEqual({ add: true, edit: true, remove: true })
  })

  it('never offers "add child" on a functionality — only categories are containers', () => {
    expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: false }, true)).toEqual({ add: false, edit: true, remove: true })
  })

  it('offers nothing at all on an immutable functionality', () => {
    expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: true }, true)).toEqual({ add: false, edit: false, remove: false })
  })

  it('treats a missing isImmutable flag as mutable', () => {
    expect(rowActions({ type: 'FUNCTIONALITY' }, true)).toEqual({ add: false, edit: true, remove: true })
  })

  it('offers nothing at all to a reader, whatever the node', () => {
    expect(rowActions({ type: 'CATEGORY', isImmutable: false }, false)).toEqual({ add: false, edit: false, remove: false })
    expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: false }, false)).toEqual({ add: false, edit: false, remove: false })
  })
})

// Il cestino di una cartella non vuota resta visibile ma disattivato. Il conteggio va fatto
// sull'albero intero: con un filtro di ricerca attivo l'albero mostrato perde dei figli, e una
// cartella piena sembrerebbe vuota proprio mentre la si guarda.
describe('childCountById', () => {
  const node = (id: number, children: UserNavigationTreeDto[] = []): UserNavigationTreeDto =>
    ({ id, name: `n${id}`, type: children.length ? 'CATEGORY' : 'FUNCTIONALITY', parentId: null, authorization: false, children })

  it('counts the direct children of every node, nested ones included', () => {
    const counts = childCountById([node(1, [node(2, [node(3), node(4)]), node(5)]), node(6)])
    expect(counts.get(1)).toBe(2)
    expect(counts.get(2)).toBe(2)
    expect(counts.get(3)).toBe(0)
    expect(counts.get(6)).toBe(0)
  })
})
