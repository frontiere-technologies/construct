// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantNotConfigured } from './TenantNotConfigured'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * «Riprova» sul messaggio "Non sei configurato su questo indirizzo" (specifica 2026-10-21, §3.2,
 * MT4-DEC-3). L'azione ricalcola il tenant della sessione e dice dove è finita; la pagina dopo la
 * carica il browser, con il suo indirizzo. Un rinvio dell'azione (redirect) farebbe disegnare la
 * pagina dopo a Next stesso con una richiesta interna all'indirizzo del server, non a quello della
 * richiesta: su `a.localhost` la sessione sembrerebbe di nuovo senza tenant (difetto del Task 11).
 */
const mocks = vi.hoisted(() => ({ refreshTenant: vi.fn(), loadPage: vi.fn(), signOut: vi.fn() }))

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/context/use-auth', () => ({ useAuth: () => ({ signOut: mocks.signOut }) }))
vi.mock('@/lib/tenancy/tenant-actions', () => ({ refreshTenant: mocks.refreshTenant }))
vi.mock('./load-page', () => ({ loadPage: mocks.loadPage }))

let root: Root | undefined
let container: HTMLDivElement | undefined

function retryButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'errors.retry')!
}

beforeEach(() => {
  mocks.refreshTenant.mockReset()
  mocks.loadPage.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<TenantNotConfigured />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('TenantNotConfigured', () => {
  it('loads the home in the browser when the retry finds a tenant', async () => {
    mocks.refreshTenant.mockResolvedValue('ready')

    await act(async () => retryButton().click())

    expect(mocks.refreshTenant).toHaveBeenCalledTimes(1)
    expect(mocks.loadPage).toHaveBeenCalledWith('/')
  })

  it('loads the home also when there is now a choice to make: the proxy sends it to the chooser', async () => {
    mocks.refreshTenant.mockResolvedValue('choose')

    await act(async () => retryButton().click())

    expect(mocks.loadPage).toHaveBeenCalledWith('/')
  })

  it('stays on the message, without loading anything, when there is still no tenant', async () => {
    mocks.refreshTenant.mockResolvedValue('none')

    await act(async () => retryButton().click())

    expect(mocks.loadPage).not.toHaveBeenCalled()
    expect(container!.querySelector('[data-testid="no-tenant-message"]')!.textContent).toBe('tenancy.none.message')
    expect(retryButton().disabled).toBe(false)
  })
})
