import { describe, it, expect } from 'vitest'
import { ITEM_TYPES, isTypeLocked, resolveItemType, typeOptionsFor } from './item-type-options'

describe('ITEM_TYPES', () => {
  it('offers exactly the four kinds the form can create', () => {
    expect(ITEM_TYPES.map(t => t.key)).toEqual(['category', 'embedded', 'external', 'internal'])
  })
})

describe('resolveItemType', () => {
  it('resolves a category regardless of the functionality type carried along', () => {
    expect(resolveItemType(1, null)?.key).toBe('category')
    expect(resolveItemType(1, 3)?.key).toBe('category')
  })

  it('resolves each functionality kind from its idFunctionalityType', () => {
    expect(resolveItemType(2, 1)?.key).toBe('embedded')
    expect(resolveItemType(2, 2)?.key).toBe('external')
    expect(resolveItemType(2, 3)?.key).toBe('internal')
  })

  it('resolves nothing while no type has been picked yet (create-mode initial state)', () => {
    // Regression: a null idFunctionalityType used to match the category entry
    // (also null), so the closed dropdown misleadingly displayed "Category"
    // while the item was still a functionality with the Link field showing.
    expect(resolveItemType(2, null)).toBeNull()
  })

  it('resolves nothing for functionality types the form cannot create', () => {
    expect(resolveItemType(2, 4)).toBeNull() // REMOTE_DESKTOP
    expect(resolveItemType(2, 5)).toBeNull() // PERMISSION
  })
})

describe('typeOptionsFor', () => {
  it('offers every option while creating', () => {
    expect(typeOptionsFor('create', 2).map(o => o.key)).toEqual(['category', 'embedded', 'external', 'internal'])
    // La tipologia salvata non conta in creazione: non c'è ancora una voce salvata.
    expect(typeOptionsFor('create', 1).map(o => o.key)).toEqual(['category', 'embedded', 'external', 'internal'])
  })

  it('offers only the three functionality subtypes when editing a functionality', () => {
    expect(typeOptionsFor('edit', 2).map(o => o.key)).toEqual(['embedded', 'external', 'internal'])
  })

  it('does not offer «category» when editing a functionality', () => {
    // È il confine che updateNavigationItem rifiuta: offrirlo darebbe un campo che accetta
    // una scelta e poi la rifiuta al salvataggio (DEC-16).
    expect(typeOptionsFor('edit', 2).map(o => o.key)).not.toContain('category')
  })

  it('offers only «category» when editing a category', () => {
    expect(typeOptionsFor('edit', 1).map(o => o.key)).toEqual(['category'])
  })
})

describe('isTypeLocked', () => {
  it('never locks the control while creating', () => {
    expect(isTypeLocked('create', 1)).toBe(false)
    expect(isTypeLocked('create', 2)).toBe(false)
  })

  it('locks it on a category being edited, where the side has a single option', () => {
    expect(isTypeLocked('edit', 1)).toBe(true)
  })

  it('leaves it open on a functionality being edited: three subtypes to choose from', () => {
    expect(isTypeLocked('edit', 2)).toBe(false)
  })
})
