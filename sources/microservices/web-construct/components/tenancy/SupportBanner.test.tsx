// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ endSupport: vi.fn(), loadPage: vi.fn() }))

// Il modulo vero è una server action: arriva al database, che qui non c'è.
vi.mock('@/lib/platform/support-actions', () => ({ endSupport: mocks.endSupport }))
vi.mock('./load-page', () => ({ loadPage: mocks.loadPage }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => params ? `${key}|${JSON.stringify(params)}` : key,
    fmt: { dateTime: (value: string) => `dt:${value}` },
  }),
}))

const { SupportBanner } = await import('./SupportBanner')

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  mocks.endSupport.mockReset().mockResolvedValue({ state: 'ready' })
  mocks.loadPage.mockReset()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

function render(tenantName: string, until: string | null) {
  act(() => {
    root = createRoot(container!)
    root.render(<SupportBanner tenantName={tenantName} until={until} />)
  })
}

const exitButton = () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'platform.support.exit')!

describe('SupportBanner', () => {
  it('says that the platform works in the tenant until the expiry', () => {
    render('Acme', '2026-10-27T12:00:00.000Z')
    const banner = container!.querySelector('[data-testid="support-banner"]')!
    expect(banner.textContent).toContain('platform.support.banner|{"tenant":"Acme","time":"dt:2026-10-27T12:00:00.000Z"}')
    expect(exitButton()).toBeDefined()
  })

  it('has no expiry for the template', () => {
    render('Modello', null)
    expect(container!.textContent).toContain('platform.support.banner_no_end|{"tenant":"Modello"}')
    expect(container!.textContent).not.toContain('platform.support.banner|')
  })

  it('Esci ends support and then loads the console in the browser', async () => {
    render('Acme', '2026-10-27T12:00:00.000Z')
    await act(async () => { exitButton().click() })
    expect(mocks.endSupport).toHaveBeenCalledTimes(1)
    expect(mocks.loadPage).toHaveBeenCalledWith('/platform')
    // Prima l'uscita (voce nei registri e token), poi la pagina: mai il contrario.
    expect(mocks.endSupport.mock.invocationCallOrder[0]).toBeLessThan(mocks.loadPage.mock.invocationCallOrder[0])
  })

  it('a failed exit does not leave the page: the banner stays and the error is visible', async () => {
    mocks.endSupport.mockRejectedValue(new Error('down'))
    render('Acme', '2026-10-27T12:00:00.000Z')
    await act(async () => { exitButton().click() })
    expect(mocks.loadPage).not.toHaveBeenCalled()
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('platform.support.exit_error')
    expect(exitButton().disabled).toBe(false)
  })
})
