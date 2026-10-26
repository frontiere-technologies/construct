// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantSwitcher } from './TenantSwitcher'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Il selettore in cima alla barra laterale (specifica 2026-10-21, §3.2, MT4-DEC-5): il nome del
 * tenant corrente sempre visibile; l'elenco a comparsa, con scorrimento, solo con più di un
 * tenant sull'indirizzo; con la barra compressa resta raggiungibile da un bottone con nome
 * accessibile. jsdom non fa impaginazione: dello scorrimento si controllano le classi.
 */
const mocks = vi.hoisted(() => ({ chooseTenant: vi.fn(), refresh: vi.fn(), loadPage: vi.fn() }))

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/tenancy/tenant-actions', () => ({ chooseTenant: mocks.chooseTenant }))
vi.mock('@/components/tenancy/load-page', () => ({ loadPage: mocks.loadPage }))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}))

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.scrollIntoView ??= () => {}

let root: Root | undefined
let container: HTMLDivElement | undefined

const ALFA = { id: 7, name: 'Alfa' }
const BETA = { id: 9, name: 'Beta' }

function render(props: { tenants: { id: number; name: string }[]; collapsed?: boolean; current?: { id: number; name: string } }) {
  act(() => root?.render(
    <TenantSwitcher current={props.current ?? ALFA} tenants={props.tenants} collapsed={props.collapsed ?? false} />,
  ))
}

const trigger = () => container!.querySelector<HTMLButtonElement>('[data-testid="tenant-switcher-trigger"]')
const press = (el: Element, key: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))

beforeEach(() => {
  mocks.chooseTenant.mockReset().mockResolvedValue('ready')
  mocks.refresh.mockReset()
  mocks.loadPage.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

describe('TenantSwitcher', () => {
  it('shows the current tenant name and no list with a single tenant', () => {
    render({ tenants: [ALFA] })

    expect(container!.querySelector('[data-testid="tenant-switcher-current"]')?.textContent).toContain('Alfa')
    expect(trigger()).toBeNull()
    expect(container!.querySelector('button')).toBeNull()
  })

  it('opens a scrollable list with several tenants and marks the current one', () => {
    render({ tenants: [ALFA, BETA] })

    expect(trigger()?.textContent).toContain('Alfa')
    expect(trigger()?.getAttribute('aria-haspopup')).toBe('menu')
    press(trigger()!, 'Enter')

    expect(options().map(o => o.textContent)).toEqual(['Alfa', 'Beta'])
    expect(options().map(o => o.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    const list = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(list.classList.contains('overflow-y-auto')).toBe(true)
    expect(Array.from(list.classList).some(name => /^max-h-/.test(name))).toBe(true)
  })

  it('choosing another tenant calls chooseTenant with its id', async () => {
    render({ tenants: [ALFA, BETA] })
    press(trigger()!, 'Enter')

    await act(async () => options()[1].click())

    expect(mocks.chooseTenant).toHaveBeenCalledTimes(1)
    expect(mocks.chooseTenant).toHaveBeenCalledWith(9)
    // La home la carica il browser da capo, non un redirect dell'azione.
    expect(mocks.loadPage).toHaveBeenCalledWith('/')
  })

  it('choosing the current tenant does nothing', () => {
    render({ tenants: [ALFA, BETA] })
    press(trigger()!, 'Enter')

    act(() => options()[0].click())

    expect(mocks.chooseTenant).not.toHaveBeenCalled()
  })

  it('is reachable with the sidebar collapsed (icon button with accessible name)', () => {
    render({ tenants: [ALFA, BETA], collapsed: true })

    const button = trigger()!
    expect(button.getAttribute('aria-label')).toContain('tenancy.switch.label')
    expect(button.getAttribute('aria-label')).toContain('Alfa')
    expect(button.textContent?.trim()).toBe('')
    press(button, 'Enter')
    expect(options()).toHaveLength(2)
  })

  it('names the current tenant for assistive technology when collapsed with a single tenant', () => {
    render({ tenants: [ALFA], collapsed: true })

    const current = container!.querySelector('[data-testid="tenant-switcher-current"]')!
    expect(current.getAttribute('aria-label')).toContain('Alfa')
    expect(current.getAttribute('title')).toBe('Alfa')
    expect(container!.querySelector('button')).toBeNull()
  })

  it('lets the name of a long tenant ellipse instead of widening the sidebar', () => {
    render({ tenants: [{ id: 7, name: `Alfa${'a'.repeat(80)}` }] })

    const name = container!.querySelector('[data-testid="tenant-switcher-name"]')!
    expect(name.classList.contains('truncate')).toBe(true)
    expect(name.classList.contains('min-w-0')).toBe(true)
  })
})
