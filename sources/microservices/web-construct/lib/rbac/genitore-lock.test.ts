import { describe, it, expect } from 'vitest'
import { isGenitoreLocked, buildGenitoreOptions, genitoreValue, parseGenitoreSelection, ROOT_OPTION_LABEL } from './genitore-lock'
import { ROOT_ID } from './types'

describe('isGenitoreLocked', () => {
  it('locks when no mutable category exists to nest under: Root is the only choice', () => {
    expect(isGenitoreLocked(0)).toBe(true)
  })

  it('unlocks once at least one mutable category exists, in create and in edit alike', () => {
    expect(isGenitoreLocked(1)).toBe(false)
    expect(isGenitoreLocked(3)).toBe(false)
  })
})

describe('buildGenitoreOptions', () => {
  const opt = (id: number, name: string, navbarPosition: 'TOP' | 'BOTTOM' | null = null) => ({ id, name, navbarPosition })

  it('always offers Root so an item can be placed back at the top level', () => {
    expect(buildGenitoreOptions([])).toEqual([{ value: ROOT_ID, label: ROOT_OPTION_LABEL }])
  })

  it('follows the sidebar: sections pinned to the top, then Root, then those pinned to the bottom', () => {
    // Home is seeded navbar_position TOP and Admin BOTTOM, so this reads Home, Root, Admin, ...
    const parents = [opt(1, 'Home', 'TOP'), opt(6, 'Admin', 'BOTTOM'), opt(526, 'aaa'), opt(700, 'bbb')]
    expect(buildGenitoreOptions(parents).map(o => o.label)).toEqual(['Home', 'Root', 'Admin', 'aaa', 'bbb'])
  })

  it('keeps Root first when nothing is pinned above it', () => {
    expect(buildGenitoreOptions([opt(12, 'Reports'), opt(9, 'Tools')]).map(o => o.label))
      .toEqual(['Root', 'Reports', 'Tools'])
  })

  it('preserves the incoming order inside each group', () => {
    const parents = [opt(3, 'Top B', 'TOP'), opt(2, 'Top A', 'TOP'), opt(9, 'Zeta'), opt(4, 'Alpha')]
    expect(buildGenitoreOptions(parents).map(o => o.label)).toEqual(['Top B', 'Top A', 'Root', 'Zeta', 'Alpha'])
  })

  it('carries the category ids through as option values', () => {
    expect(buildGenitoreOptions([opt(1, 'Home', 'TOP'), opt(526, 'aaa')])).toEqual([
      { value: 1, label: 'Home' },
      { value: ROOT_ID, label: ROOT_OPTION_LABEL },
      { value: 526, label: 'aaa' },
    ])
  })
})

describe('genitoreValue', () => {
  it('shows Root when no explicit parent is set', () => {
    expect(genitoreValue(null)).toBe(ROOT_ID)
  })

  it('shows Root for items already stored at the root', () => {
    expect(genitoreValue(ROOT_ID)).toBe(ROOT_ID)
  })

  it('shows the category itself for nested items', () => {
    expect(genitoreValue(12)).toBe(12)
  })
})

describe('parseGenitoreSelection', () => {
  it('maps the Root sentinel back to null — the menu root is the absence of a parent', () => {
    expect(parseGenitoreSelection(ROOT_ID)).toBeNull()
  })

  it('passes a real category id through unchanged', () => {
    expect(parseGenitoreSelection(12)).toBe(12)
  })

  it('round-trips with genitoreValue', () => {
    expect(parseGenitoreSelection(genitoreValue(null))).toBeNull()
    expect(parseGenitoreSelection(genitoreValue(12))).toBe(12)
  })
})
