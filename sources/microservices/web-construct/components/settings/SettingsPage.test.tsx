// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const mocks = vi.hoisted(() => ({ saveAppearance: vi.fn() }))

vi.mock('@/lib/appearance-actions', () => ({ saveAppearance: mocks.saveAppearance }))
vi.mock('@/components/LanguageSwitcher', () => ({ default: () => <div data-testid="language-switcher" /> }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    fmt: { date: () => '02/10/2026', number: () => '1.234.567' },
    languages: [{ code: 'it' }, { code: 'en' }],
  }),
}))

const { SettingsPage } = await import('./SettingsPage')

let root: Root | undefined
let container: HTMLDivElement | undefined
const html = document.documentElement

beforeEach(() => {
  mocks.saveAppearance.mockReset()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsPage initialAppearance={{ mode: 'light', scale: 100 }} />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  html.classList.remove('dark')
  html.removeAttribute('data-theme-mode')
  html.style.removeProperty('font-size')
})

const radio = (name: string) =>
  Array.from(container!.querySelectorAll('[role="radio"]')).find(el => el.textContent?.includes(name)) as HTMLButtonElement

describe('SettingsPage', () => {
  it('applies a mode at once and saves it', async () => {
    mocks.saveAppearance.mockResolvedValue({ error: null, appearance: { mode: 'dark', scale: 100 } })
    await act(async () => radio('settings.theme.dark').click())
    expect(html.classList.contains('dark')).toBe(true)
    expect(html.getAttribute('data-theme-mode')).toBe('dark')
    expect(mocks.saveAppearance).toHaveBeenCalledWith({ mode: 'dark' })
    expect(radio('settings.theme.dark').getAttribute('aria-checked')).toBe('true')
  })

  it('reverts the choice and says so when the save fails', async () => {
    mocks.saveAppearance.mockResolvedValue({ error: 'Save failed' })
    await act(async () => radio('settings.theme.dark').click())
    expect(html.classList.contains('dark')).toBe(false)
    expect(radio('settings.theme.light').getAttribute('aria-checked')).toBe('true')
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('settings.status.save_failed')
  })

  it('shows the language switcher and a read-only date format example', () => {
    expect(container!.querySelector('[data-testid="language-switcher"]')).not.toBeNull()
    expect(container!.textContent).toContain('02/10/2026 · 1.234.567')
  })

  it('offers the text size as a slider between 90 and 130', () => {
    const thumb = container!.querySelector('[role="slider"]')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('100')
    expect(thumb?.getAttribute('aria-valuemin')).toBe('90')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('130')
  })
})
