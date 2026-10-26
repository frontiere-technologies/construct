// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ setSelfRegistration: vi.fn() }))

vi.mock('@/lib/tenancy/tenant-settings-actions', () => ({ setSelfRegistration: mocks.setSelfRegistration }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { TenantSettings } = await import('./TenantSettings')

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  mocks.setSelfRegistration.mockReset()
  mocks.setSelfRegistration.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

function render(initialEnabled: boolean, selfRegistrationApplies = true) {
  act(() => {
    root = createRoot(container!)
    root.render(<TenantSettings initialEnabled={initialEnabled} selfRegistrationApplies={selfRegistrationApplies} />)
  })
}

/** Quante volte compare l'etichetta dell'interruttore (non la sua spiegazione, `…_hint`). */
const labelCount = () => (container!.textContent!.match(/tenancy\.settings\.self_registration(?!_)/g) ?? []).length

const toggle = () => container!.querySelector<HTMLButtonElement>('[role="switch"]')!

describe('TenantSettings', () => {
  it('the switch shows the saved state and the saved message', async () => {
    render(false)
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(container!.textContent).toContain('tenancy.settings.title')
    expect(container!.textContent).toContain('tenancy.settings.self_registration')
    expect(container!.textContent).not.toContain('tenancy.settings.saved')

    await act(async () => { toggle().click() })

    expect(mocks.setSelfRegistration).toHaveBeenCalledWith(true)
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(container!.textContent).toContain('tenancy.settings.saved')
  })

  it('starts on when the tenant already accepts self-registration, and turns it off', async () => {
    render(true)
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    await act(async () => { toggle().click() })
    expect(mocks.setSelfRegistration).toHaveBeenCalledWith(false)
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })

  it('shows the switch label once: the section has no heading with the same words', () => {
    render(false)
    expect(labelCount()).toBe(1)
  })

  // Senza un indirizzo dedicato chi si registra dall'indirizzo principale entra nel predefinito
  // (MT4-DEC-9): l'interruttore lì non avrebbe effetto, quindi c'è una riga che lo spiega.
  it('without an address of its own the tenant gets an explanation instead of the switch', () => {
    render(true, false)
    expect(container!.querySelector('[role="switch"]')).toBeNull()
    expect(container!.textContent).toContain('tenancy.settings.self_registration_no_address')
    expect(container!.textContent).toContain('tenancy.settings.title')
  })

  it('keeps the previous state and does not say saved when the action fails', async () => {
    mocks.setSelfRegistration.mockRejectedValue(new Error('Unauthorized'))
    render(false)
    await act(async () => { toggle().click() })
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(container!.textContent).not.toContain('tenancy.settings.saved')
    expect(container!.textContent).toContain('theme.status.save_failed')
  })
})
