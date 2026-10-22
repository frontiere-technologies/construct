// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantChooser, type TenantChoice } from './TenantChooser'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * La pagina di scelta a schede (specifica 2026-10-21, §3.2, MT4-DEC-4): una scheda per tenant con
 * nome e ruolo, griglia che va a capo, elenco che scorre quando i tenant sono molti. jsdom non fa
 * impaginazione: si controllano le classi che la decidono.
 */
const mocks = vi.hoisted(() => ({ chooseTenant: vi.fn(), refresh: vi.fn() }))

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}))
vi.mock('@/lib/tenancy/tenant-actions', () => ({ chooseTenant: mocks.chooseTenant }))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}))

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(tenants: TenantChoice[]) {
  act(() => root?.render(<TenantChooser userName="Ada" tenants={tenants} />))
}

function cards(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('[data-testid="tenant-card"]'))
}

/** Una classe che fissa la larghezza: `w-64`, `w-[20rem]`, `min-w-[…]`. `w-full` e `max-w-*` no. */
function fixedWidthClasses(element: Element): string[] {
  return Array.from(element.classList).filter(name => /^(min-)?w-(\d|\[|px)/.test(name))
}

beforeEach(() => {
  mocks.chooseTenant.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('TenantChooser', () => {
  it('renders one card per tenant with name and role', () => {
    render([
      { tenantId: 7, name: 'Alfa', isAdmin: true },
      { tenantId: 9, name: 'Bravo', isAdmin: false },
    ])

    expect(container!.textContent).toContain('tenancy.choose.title {"name":"Ada"}')
    expect(container!.textContent).toContain('tenancy.choose.hint')
    const found = cards()
    expect(found).toHaveLength(2)
    expect(found[0].textContent).toContain('Alfa')
    expect(found[0].textContent).toContain('tenancy.role.admin')
    expect(found[1].textContent).toContain('Bravo')
    expect(found[1].textContent).toContain('tenancy.role.user')
    for (const card of found) expect(card.tagName).toBe('BUTTON')
  })

  it('chooses the tenant of the clicked card', async () => {
    render([
      { tenantId: 7, name: 'Alfa', isAdmin: true },
      { tenantId: 9, name: 'Bravo', isAdmin: false },
    ])

    await act(async () => cards()[1].click())

    expect(mocks.chooseTenant).toHaveBeenCalledTimes(1)
    expect(mocks.chooseTenant).toHaveBeenCalledWith(9)
  })

  it('reloads the list when the server refuses the choice', async () => {
    mocks.chooseTenant.mockRejectedValue(new Error('tenant_not_available'))
    render([{ tenantId: 7, name: 'Alfa', isAdmin: false }])

    await act(async () => cards()[0].click())

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('stays scrollable with twelve tenants', () => {
    render(Array.from({ length: 12 }, (_, index) => ({ tenantId: index + 1, name: `Tenant ${index + 1}`, isAdmin: index % 2 === 0 })))

    expect(cards()).toHaveLength(12)
    const list = container!.querySelector('[data-testid="tenant-list"]')!
    // L'elenco ha un'altezza limitata e scorre; la griglia va a capo da sola, senza larghezze fisse.
    expect(list.classList.contains('overflow-y-auto')).toBe(true)
    expect(Array.from(list.classList).some(name => name.startsWith('max-h-'))).toBe(true)
    expect(Array.from(list.classList).some(name => name.includes('auto-fill'))).toBe(true)
    expect(fixedWidthClasses(list)).toEqual([])
    for (const card of cards()) expect(fixedWidthClasses(card)).toEqual([])
    // Un nome lungo va a capo dentro la scheda invece di allargarla.
    for (const card of cards()) expect(card.querySelector('[data-testid="tenant-name"]')!.classList.contains('break-words')).toBe(true)
  })
})
