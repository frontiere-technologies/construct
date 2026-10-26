// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '@/types/menu'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Il selettore del tenant in cima alla barra (specifica 2026-10-21, §3.2, MT4-DEC-5): c'è solo
 * quando il layout protetto passa la proprietà, e sta prima delle voci della barra.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: (error: unknown) => { throw error },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/use-auth', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/tenancy/tenant-actions', () => ({ chooseTenant: vi.fn() }))

async function waitFor<T extends Element>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = find()
    if (found) return found
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }
  throw new Error('element not found')
}

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  // Node 26 espone un `localStorage` globale che nasconde quello di jsdom: lo sostituisce una copia.
  // La colonna parte compressa: qui la si vuole aperta, perché il nome si legga.
  const store = new Map<string, string>([['sidebarCollapseState', JSON.stringify({ col1: false })]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  })
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
  vi.unstubAllGlobals()
})

describe('Sidebar tenant switcher', () => {
  it('shows the current tenant above the menu entries when the layout passes it', async () => {
    const menuItems: MenuItem[] = [
      { id: 'home', label: 'Home', route: '/', parentId: null, type: 'link', visible: true, active: true, order: 0, position: 'top' },
    ]
    await act(async () => {
      root?.render(
        <Sidebar
          menuItems={menuItems}
          tenantSwitcher={{ current: { id: 7, name: 'Alfa' }, tenants: [{ id: 7, name: 'Alfa' }] }}
        />,
      )
    })

    // Il selettore è un modulo caricato a richiesta: si aspetta che compaia.
    const current = await waitFor(() => container!.querySelector('[data-testid="tenant-switcher-current"]'))
    expect(current.textContent).toContain('Alfa')
    const firstEntry = container!.querySelector('a[href="/"]')!
    expect(current.compareDocumentPosition(firstEntry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing about tenants without the property', async () => {
    await act(async () => { root?.render(<Sidebar menuItems={[]} />) })

    expect(container!.querySelector('[data-testid="tenant-switcher-current"]')).toBeNull()
    expect(container!.querySelector('[data-testid="tenant-switcher-trigger"]')).toBeNull()
  })
})
