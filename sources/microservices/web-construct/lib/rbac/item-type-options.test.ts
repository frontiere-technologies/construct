import { describe, it, expect } from 'vitest'
import { ITEM_TYPES, resolveItemType } from './item-type-options'

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
