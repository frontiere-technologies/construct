// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ setSelfRegistration: vi.fn(), grantSupportConsent: vi.fn(), revokeSupportConsent: vi.fn() }))

vi.mock('@/lib/tenancy/tenant-settings-actions', () => ({ setSelfRegistration: mocks.setSelfRegistration }))
vi.mock('@/lib/tenancy/support-consent-actions', () => ({
  grantSupportConsent: mocks.grantSupportConsent,
  revokeSupportConsent: mocks.revokeSupportConsent,
}))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => params ? `${key}|${JSON.stringify(params)}` : key,
    fmt: { dateTime: (value: string) => `dt:${value}` },
  }),
}))

const { TenantSettings } = await import('./TenantSettings')

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  mocks.setSelfRegistration.mockReset()
  mocks.setSelfRegistration.mockResolvedValue(undefined)
  mocks.grantSupportConsent.mockReset()
  mocks.revokeSupportConsent.mockReset()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

type Support = { until: string | null; inProgress: boolean; locked: boolean }
const NO_CONSENT: Support = { until: null, inProgress: false, locked: false }

function render(initialEnabled: boolean, selfRegistrationApplies = true, support: Support = NO_CONSENT) {
  act(() => {
    root = createRoot(container!)
    root.render(<TenantSettings initialEnabled={initialEnabled} selfRegistrationApplies={selfRegistrationApplies} support={support} />)
  })
}

const buttonNamed = (text: string) => Array.from(container!.querySelectorAll('button')).find(button => button.textContent === text)

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

// Pezzo 5a, Task 9 (MT5-DEC-10, MT5-DEC-12): il permesso di assistenza alla piattaforma.
describe('TenantSettings: support consent', () => {
  it('without a valid consent says so and offers the three durations, without a revoke button', () => {
    render(false)
    expect(container!.textContent).toContain('tenancy.support.title')
    expect(container!.textContent).toContain('tenancy.support.not_granted')
    for (const duration of ['1h', '1d', '1w']) expect(buttonNamed(`tenancy.support.duration.${duration}`)).toBeDefined()
    expect(buttonNamed('tenancy.support.revoke')).toBeUndefined()
  })

  it('a duration grants the consent and shows its expiry from the server', async () => {
    mocks.grantSupportConsent.mockResolvedValue({ ok: true, until: '2026-10-28T10:00:00.000Z' })
    render(false)
    await act(async () => { buttonNamed('tenancy.support.duration.1d')!.click() })
    expect(mocks.grantSupportConsent).toHaveBeenCalledWith('1d')
    expect(container!.textContent).toContain('tenancy.support.granted_until|{"time":"dt:2026-10-28T10:00:00.000Z"}')
    expect(buttonNamed('tenancy.support.revoke')).toBeDefined()
  })

  it('revoke removes the consent', async () => {
    mocks.revokeSupportConsent.mockResolvedValue({ ok: true })
    render(false, true, { until: '2026-10-28T10:00:00.000Z', inProgress: true, locked: false })
    expect(container!.textContent).toContain('tenancy.support.in_progress')
    await act(async () => { buttonNamed('tenancy.support.revoke')!.click() })
    expect(mocks.revokeSupportConsent).toHaveBeenCalledTimes(1)
    expect(container!.textContent).toContain('tenancy.support.not_granted')
    expect(container!.textContent).not.toContain('tenancy.support.in_progress')
  })

  it('a failed change keeps the state and shows the error', async () => {
    mocks.grantSupportConsent.mockRejectedValue(new Error('Unauthorized'))
    render(false)
    await act(async () => { buttonNamed('tenancy.support.duration.1w')!.click() })
    expect(container!.textContent).toContain('tenancy.support.not_granted')
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('tenancy.support.error')
  })

  it('during support the platform sees the consent but cannot change it', () => {
    render(false, true, { until: '2026-10-28T10:00:00.000Z', inProgress: true, locked: true })
    expect(container!.textContent).toContain('tenancy.support.granted_until')
    expect(container!.textContent).toContain('tenancy.support.locked')
    for (const duration of ['1h', '1d', '1w']) expect(buttonNamed(`tenancy.support.duration.${duration}`)).toBeUndefined()
    expect(buttonNamed('tenancy.support.revoke')).toBeUndefined()
  })

  it('the consent section is there also when self-registration does not apply', () => {
    render(false, false)
    expect(container!.textContent).toContain('tenancy.settings.self_registration_no_address')
    expect(container!.textContent).toContain('tenancy.support.not_granted')
  })
})
