// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LanguageSwitcher from './LanguageSwitcher'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Language names are authored in Admin -> Translations, so they can be arbitrarily
// long. jsdom does no layout: these assert the classes that make them ellipse.
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    code: 'IT',
    languages: [
      { code: 'IT', nativeName: `Italiano${'o'.repeat(60)}` },
      { code: 'EN', nativeName: 'English' },
    ],
    setLanguage: vi.fn(),
    isSwitching: false,
  }),
}))

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<LanguageSwitcher />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('LanguageSwitcher', () => {
  it('truncates the current language name inside the fixed-width trigger', () => {
    const trigger = container!.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]')!
    const value = trigger.querySelector<HTMLSpanElement>('span.flex-1')!
    expect(value.textContent).toContain('Italiano')
    expect(value.classList.contains('truncate')).toBe(true)
    expect(value.classList.contains('min-w-0')).toBe(true)
  })

  it('truncates each language name in the open list', () => {
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]')!.click())
    const options = Array.from(document.querySelectorAll('[data-testid^="language-option-"] span'))
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.classList.contains('truncate')).toBe(true)
      expect(option.classList.contains('min-w-0')).toBe(true)
    }
  })
})
