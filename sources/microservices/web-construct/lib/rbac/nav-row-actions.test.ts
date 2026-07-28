import { describe, it, expect } from 'vitest'
import { rowActions } from './nav-row-actions'

describe('rowActions', () => {
  it('lets any category take a new child, immutable ones included', () => {
    // Home and Admin are seeded immutable categories: they can hold new items even
    // though they cannot themselves be renamed or deleted.
    expect(rowActions({ type: 'CATEGORY', isImmutable: true })).toEqual({ add: true, edit: false, remove: false })
  })

  it('gives a user-created category all three actions', () => {
    expect(rowActions({ type: 'CATEGORY', isImmutable: false })).toEqual({ add: true, edit: true, remove: true })
  })

  it('never offers "add child" on a functionality — only categories are containers', () => {
    expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: false })).toEqual({ add: false, edit: true, remove: true })
  })

  it('offers nothing at all on an immutable functionality', () => {
    expect(rowActions({ type: 'FUNCTIONALITY', isImmutable: true })).toEqual({ add: false, edit: false, remove: false })
  })

  it('treats a missing isImmutable flag as mutable', () => {
    expect(rowActions({ type: 'FUNCTIONALITY' })).toEqual({ add: false, edit: true, remove: true })
  })
})
