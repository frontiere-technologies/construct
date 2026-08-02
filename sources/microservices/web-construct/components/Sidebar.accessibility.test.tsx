// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '@/types/menu'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const navigation = vi.hoisted(() => ({ pathname: '/unmatched-route' }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/UIContext', () => ({
  useUI: () => ({ settings: { theme: 'light' }, setSettings: vi.fn() }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const menuItems: MenuItem[] = [
  {
    id: 'projects', label: 'Projects', type: 'container', parentId: null,
    order: 1, visible: true, active: true, position: 'main',
  },
  {
    id: 'archive', label: 'Archive', type: 'container', parentId: 'projects',
    order: 1, visible: true, active: true, position: 'main',
  },
  {
    id: 'closed', label: 'Closed projects', type: 'link', parentId: 'archive',
    route: '/projects/closed', order: 1, visible: true, active: true, position: 'main',
  },
]

let root: Root | undefined
let container: HTMLDivElement | undefined

function renderSidebar() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Sidebar menuItems={menuItems} />))
}

function buttonNamed(name: string) {
  return Array.from(container?.querySelectorAll('button') ?? [])
    .find(button => button.getAttribute('aria-label') === name || button.textContent?.includes(name)) as HTMLButtonElement
}

beforeEach(() => {
  navigation.pathname = '/unmatched-route'
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('Sidebar disclosure accessibility', () => {
  it('exposes the closed and open state of a top-level container and its controlled panel', () => {
    renderSidebar()
    const projects = buttonNamed('Projects')

    expect(projects.getAttribute('aria-expanded')).toBe('false')
    const panelId = projects.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId!)).toBeNull()

    act(() => projects.click())

    expect(projects.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(panelId!)).not.toBeNull()

    act(() => projects.click())

    expect(projects.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(panelId!)).toBeNull()
  })

  it('exposes the closed and open state of a nested container and its controlled panel', () => {
    renderSidebar()
    act(() => buttonNamed('Projects').click())
    const archive = buttonNamed('Archive')

    expect(archive.getAttribute('aria-expanded')).toBe('false')
    const panelId = archive.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId!)).toBeNull()

    act(() => archive.click())

    expect(archive.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(panelId!)).not.toBeNull()

    act(() => archive.click())

    expect(archive.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(panelId!)).toBeNull()
  })

  it('cancels a pending hover-open timer when navigation closes the preview', () => {
    vi.useFakeTimers()
    renderSidebar()

    const masterToggle = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-master-toggle"]')!
    act(() => masterToggle.click())
    const rail = document.querySelector<HTMLElement>('aside')!

    act(() => {
      rail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    const preview = document.querySelector<HTMLElement>('[data-testid="sidebar-hover-preview"]')!
    expect(preview).not.toBeNull()

    // Entering the newly mounted overlay schedules another open timer. A route
    // change must cancel it as well as closing the currently visible preview.
    act(() => preview.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    navigation.pathname = '/profile'
    act(() => root?.render(<Sidebar menuItems={menuItems} />))
    expect(document.querySelector('[data-testid="sidebar-hover-preview"]')).toBeNull()

    act(() => vi.advanceTimersByTime(200))
    expect(document.querySelector('[data-testid="sidebar-hover-preview"]')).toBeNull()
  })
})
