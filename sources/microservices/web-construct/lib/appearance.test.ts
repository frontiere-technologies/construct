// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DARK_CLASS, DEFAULT_APPEARANCE, THEME_MODE_SCRIPT, appearancePatchSchema, applyAppearance,
  parseAppearanceCookie, serializeAppearance, toAppearance,
} from './appearance'

describe('appearance cookie', () => {
  it('round-trips every valid value', () => {
    for (const mode of ['light', 'dark', 'system'] as const) {
      for (const scale of [90, 100, 110, 120, 130] as const) {
        expect(parseAppearanceCookie(serializeAppearance({ mode, scale }))).toEqual({ mode, scale })
      }
    }
  })

  it.each([undefined, null, '', 'dark', 'dark.105', 'sepia.100', 'dark.100.1', 'DARK.100'])(
    'rejects %j instead of guessing',
    raw => expect(parseAppearanceCookie(raw)).toBeNull(),
  )
})

describe('toAppearance', () => {
  it('passes valid profile values through', () => {
    expect(toAppearance({ themeMode: 'dark', textScale: 120 })).toEqual({ mode: 'dark', scale: 120 })
  })

  it('falls back field by field on a value the database should never hold', () => {
    expect(toAppearance({ themeMode: 'sepia', textScale: 120 })).toEqual({ mode: DEFAULT_APPEARANCE.mode, scale: 120 })
    expect(toAppearance({ themeMode: 'dark', textScale: 105 })).toEqual({ mode: 'dark', scale: DEFAULT_APPEARANCE.scale })
  })
})

describe('appearancePatchSchema', () => {
  it('accepts a partial patch', () => {
    expect(appearancePatchSchema.safeParse({ mode: 'light' }).success).toBe(true)
    expect(appearancePatchSchema.safeParse({ scale: 130 }).success).toBe(true)
  })

  it.each([{ mode: 'sepia' }, { scale: 105 }, { scale: '110' }, { mode: 'dark', extra: 1 }])(
    'rejects %j',
    patch => expect(appearancePatchSchema.safeParse(patch).success).toBe(false),
  )
})

describe('THEME_MODE_SCRIPT', () => {
  let listeners: (() => void)[]
  let osDark: boolean

  beforeEach(() => {
    listeners = []
    osDark = false
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() { return osDark },
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      }),
    })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.classList.remove(DARK_CLASS)
  })

  const run = (mode: string) => {
    document.documentElement.setAttribute('data-theme-mode', mode)
    new Function(THEME_MODE_SCRIPT)()
  }
  const isDark = () => document.documentElement.classList.contains(DARK_CLASS)

  it('adds the dark class for dark and removes it for light', () => {
    run('dark')
    expect(isDark()).toBe(true)
    run('light')
    expect(isDark()).toBe(false)
  })

  it('follows the operating system in system mode, including later changes', () => {
    osDark = true
    run('system')
    expect(isDark()).toBe(true)
    osDark = false
    listeners.forEach(fn => fn())
    expect(isDark()).toBe(false)
  })

  it('ignores operating-system changes once the user picked a fixed mode', () => {
    run('system')
    document.documentElement.setAttribute('data-theme-mode', 'light')
    osDark = true
    listeners.forEach(fn => fn())
    expect(isDark()).toBe(false)
  })
})

describe('applyAppearance', () => {
  afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('data-theme-mode')
    root.classList.remove(DARK_CLASS)
    root.style.removeProperty('font-size')
  })

  it('writes the mode, the dark class and the text scale on the root', () => {
    const root = document.documentElement
    applyAppearance(root, { mode: 'dark', scale: 120 }, false)
    expect(root.getAttribute('data-theme-mode')).toBe('dark')
    expect(root.classList.contains(DARK_CLASS)).toBe(true)
    expect(root.style.fontSize).toBe('120%')
  })

  it('resolves system mode with the operating-system preference it is given', () => {
    const root = document.documentElement
    applyAppearance(root, { mode: 'system', scale: 100 }, true)
    expect(root.classList.contains(DARK_CLASS)).toBe(true)
    applyAppearance(root, { mode: 'system', scale: 100 }, false)
    expect(root.classList.contains(DARK_CLASS)).toBe(false)
  })

  it('does not touch the inline custom properties set by the theme preview', () => {
    const root = document.documentElement
    root.style.setProperty('--primary', '#123456')
    applyAppearance(root, { mode: 'light', scale: 90 }, false)
    expect(root.style.getPropertyValue('--primary')).toBe('#123456')
    root.style.removeProperty('--primary')
  })
})
