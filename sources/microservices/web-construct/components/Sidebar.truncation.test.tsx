// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '@/types/menu'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ usePathname: () => '/unmatched-route' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/UIContext', () => ({
  useUI: () => ({ settings: { theme: 'light' }, setSettings: vi.fn() }),
}))
vi.mock('@/context/use-auth', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
// Labels and language names are authored in Admin -> Translations, so any of them
// can be arbitrarily long. Return oversized values here: the user panel is only
// ~13rem wide, and these must truncate rather than push their row's control out.
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => `${key}${'e'.repeat(60)}`,
    code: 'IT',
    languages: [
      { code: 'IT', nativeName: `Italiano${'o'.repeat(60)}` },
      { code: 'EN', nativeName: 'English' },
    ],
    setLanguage: vi.fn(),
    isSwitching: false,
  }),
}))

const menuItems: MenuItem[] = [
  {
    id: 'projects', label: 'Projects', type: 'container', parentId: null,
    order: 1, visible: true, active: true, position: 'main',
  },
]

let root: Root | undefined
let container: HTMLDivElement | undefined

function openUserPanel() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Sidebar menuItems={menuItems} />))
  const trigger = container.querySelector<HTMLButtonElement>('[aria-controls="sidebar-user-panel"]')!
  act(() => trigger.click())
  return document.getElementById('sidebar-user-panel')!
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

/**
 * jsdom does no layout, so these assert the classes that produce the behaviour
 * rather than measuring it. `truncate` alone is not enough and is the trap this
 * guards: a flex child defaults to `min-width: auto`, so it refuses to shrink
 * below its content and a long word widens the row instead of ellipsing --
 * pushing the theme switch and the language value out of the panel. `min-w-0`
 * is what lets it shrink; only then does `truncate` ellipse. Real rendering is
 * covered by the e2e sidebar suite.
 */
describe('user panel truncation', () => {
  it('lets every row label shrink below its own text', () => {
    const panel = openUserPanel()
    // Every row of the panel, not only the two that were reported: they are all
    // the same flex row with a translator-authored label in it.
    const rows = [
      panel.querySelector<HTMLElement>('a[href="/profile"]')!,
      panel.querySelector<HTMLElement>('[role="switch"]')!.closest('div')!,
      panel.querySelector<HTMLElement>('[data-testid="language-switcher"]')!,
      panel.querySelector<HTMLElement>('.border-t button')!,
    ]

    expect(rows.every(Boolean)).toBe(true)
    for (const row of rows) {
      const labels = Array.from(row.querySelectorAll('span')).filter(s => (s.textContent ?? '').trim().length > 0)
      expect(labels.length, 'riga senza etichetta di testo').toBeGreaterThan(0)
      for (const span of labels) {
        expect(span.classList.contains('min-w-0'), `"${span.textContent?.slice(0, 16)}" manca min-w-0`).toBe(true)
        expect(span.classList.contains('truncate'), `"${span.textContent?.slice(0, 16)}" manca truncate`).toBe(true)
      }
    }
  })

  it('truncates the language value instead of letting it push the row wider', () => {
    const panel = openUserPanel()
    const trigger = panel.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]')!
    const value = trigger.querySelector<HTMLSpanElement>('span:not(.flex-1)')!

    expect(value.textContent).toContain('Italiano')
    expect(value.classList.contains('truncate')).toBe(true)
    expect(value.classList.contains('min-w-0')).toBe(true)
  })

  // `min-w-0` on the value alone swaps one bug for another: the label is
  // `flex-1`, i.e. flex-basis 0, and shrinkage is shared out in proportion to
  // flex-shrink x flex-basis -- so the label's share is 1 x 0 = 0. It absorbs
  // none of it, the value keeps its full content width, and "Language"
  // collapses to 0px. A max-width cap on the value is what leaves the label room.
  it('caps the language value so the label never collapses', () => {
    const panel = openUserPanel()
    const trigger = panel.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]')!
    const value = trigger.querySelector<HTMLSpanElement>('span:not(.flex-1)')!

    const capped = Array.from(value.classList).some(c => /^max-w-/.test(c))
    expect(capped, `il valore "${value.textContent?.slice(0, 12)}" non ha un tetto di larghezza`).toBe(true)
  })

  it('truncates each language name in the open list', () => {
    const panel = openUserPanel()
    act(() => panel.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]')!.click())
    const options = Array.from(document.querySelectorAll('[data-testid^="language-option-"] span'))

    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.classList.contains('truncate')).toBe(true)
      expect(option.classList.contains('min-w-0')).toBe(true)
    }
  })
})
