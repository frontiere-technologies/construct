// @vitest-environment jsdom

import React, { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ usePathname: () => '/unmatched-route' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/use-auth', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const COLLAPSE_KEY = 'sidebarCollapseState'

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

// `next dev` monta la pagina in Strict Mode, che esegue due volte gli effetti al montaggio: il
// salvataggio non deve scrivere lo stato iniziale sopra quello salvato prima che sia stato riletto.
describe('Sidebar collapse persistence', () => {
  it('restores a master-collapsed sidebar under Strict Mode', () => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: true, master: true }))

    act(() => root?.render(<StrictMode><Sidebar menuItems={[]} /></StrictMode>))

    expect(container!.querySelector('[data-testid="sidebar-collapsed-rail"]')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem(COLLAPSE_KEY)!)).toMatchObject({ master: true })
  })

  it('restores the sub-column collapse under Strict Mode', () => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: false, master: false, col2: true }))

    act(() => root?.render(<StrictMode><Sidebar menuItems={[]} /></StrictMode>))

    expect(JSON.parse(localStorage.getItem(COLLAPSE_KEY)!)).toMatchObject({ col1: false, col2: true })
  })
})
