// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const navigation = vi.hoisted(() => ({ pathname: '/unmatched-route' }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/use-auth', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

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
  act(() => root?.render(<Sidebar menuItems={[]} />))
  act(() => (container!.querySelector('[data-testid="sidebar-account-button"]') as HTMLButtonElement).click())
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('Sidebar user panel', () => {
  it('links to the personal settings page', () => {
    const panel = document.getElementById('sidebar-user-panel')!
    const link = panel.querySelector('a[href="/settings"]')
    expect(link?.textContent).toContain('nav.settings')
  })

  it('no longer carries the theme switch or the language switcher', () => {
    const panel = document.getElementById('sidebar-user-panel')!
    expect(panel.querySelector('[role="switch"]')).toBeNull()
    expect(panel.querySelector('[data-testid="language-switcher"]')).toBeNull()
  })
})
