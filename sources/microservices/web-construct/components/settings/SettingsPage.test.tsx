// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const mocks = vi.hoisted(() => ({
  saveAppearance: vi.fn(),
  sliderProps: { current: null as null | { onValueChange?: (v: number[]) => void; onValueCommit?: (v: number[]) => void } },
}))

// Il vero Slider, ma con le sue props a portata di mano: col puntatore, nel browser,
// arrivano tanti onValueChange e un solo onValueCommit al rilascio; jsdom non sa
// farlo, quindi il test chiama le due funzioni nell'ordine reale.
vi.mock('@/components/ui/slider', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui/slider')>()
  return {
    Slider: (props: React.ComponentProps<typeof actual.Slider>) => {
      mocks.sliderProps.current = props
      return <actual.Slider {...props} />
    },
  }
})

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

/** Un trascinamento del cursore fino a `value`: onValueChange mentre si muove, onValueCommit al rilascio. */
const dragScaleTo = async (value: number) => {
  await act(async () => mocks.sliderProps.current?.onValueChange?.([value]))
  await act(async () => mocks.sliderProps.current?.onValueCommit?.([value]))
}

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

  it('keeps the mode when the slider is committed before the mode save resolves', async () => {
    let resolveMode!: (value: unknown) => void
    mocks.saveAppearance.mockImplementation((patch: { mode?: string; scale?: number }) =>
      patch.mode
        ? new Promise(resolve => { resolveMode = resolve })
        : Promise.resolve({ error: null, appearance: { mode: 'light', scale: 110 } }))
    await act(async () => { radio('settings.theme.dark').click() })
    await dragScaleTo(110)
    expect(html.classList.contains('dark')).toBe(true)
    expect(html.style.fontSize).toBe('110%')
    await act(async () => resolveMode({ error: null, appearance: { mode: 'dark', scale: 100 } }))
    expect(html.classList.contains('dark')).toBe(true)
    expect(html.style.fontSize).toBe('110%')
    expect(radio('settings.theme.dark').getAttribute('aria-checked')).toBe('true')
    expect(container!.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('110')
  })

  it('reverts only the text size when its save fails', async () => {
    mocks.saveAppearance.mockImplementation((patch: { mode?: string; scale?: number }) =>
      Promise.resolve(patch.mode
        ? { error: null, appearance: { mode: 'dark', scale: 100 } }
        : { error: 'Save failed' }))
    await act(async () => radio('settings.theme.dark').click())
    await dragScaleTo(110)
    expect(html.style.fontSize).toBe('100%')
    expect(container!.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('100')
    expect(html.classList.contains('dark')).toBe(true)
    expect(radio('settings.theme.dark').getAttribute('aria-checked')).toBe('true')
    const alert = container!.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('settings.status.save_failed')
    // L'avviso sta nella riga della dimensione del testo, non in quella del tema.
    expect(alert?.parentElement?.parentElement?.textContent).toContain('settings.field.text_size')
  })

  it('ignores a stale failure of the same field once a newer choice is in flight', async () => {
    const pending: Array<(value: unknown) => void> = []
    mocks.saveAppearance.mockImplementation(() => new Promise(resolve => { pending.push(resolve) }))
    await act(async () => { radio('settings.theme.dark').click() })
    await act(async () => { radio('settings.theme.system').click() })
    expect(pending).toHaveLength(2)
    // La prima scelta fallisce quando la seconda e' ancora in corso: non deve toccare la pagina.
    await act(async () => pending[0]({ error: 'Save failed' }))
    expect(html.getAttribute('data-theme-mode')).toBe('system')
    expect(container!.querySelector('[role="alert"]')).toBeNull()
    await act(async () => pending[1]({ error: null, appearance: { mode: 'system', scale: 100 } }))
    expect(html.getAttribute('data-theme-mode')).toBe('system')
    expect(radio('settings.theme.system').getAttribute('aria-checked')).toBe('true')
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })

  it('reverts only the text size when it fails while the mode save is still in flight', async () => {
    let resolveMode!: (value: unknown) => void
    mocks.saveAppearance.mockImplementation((patch: { mode?: string; scale?: number }) =>
      patch.mode
        ? new Promise(resolve => { resolveMode = resolve })
        : Promise.resolve({ error: 'Save failed' }))
    await act(async () => { radio('settings.theme.dark').click() })
    await dragScaleTo(110)
    expect(html.style.fontSize).toBe('100%')
    expect(html.classList.contains('dark')).toBe(true)
    await act(async () => resolveMode({ error: null, appearance: { mode: 'dark', scale: 100 } }))
    expect(html.classList.contains('dark')).toBe(true)
    expect(radio('settings.theme.dark').getAttribute('aria-checked')).toBe('true')
    expect(html.style.fontSize).toBe('100%')
    const alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].parentElement?.parentElement?.textContent).toContain('settings.field.text_size')
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
    expect(thumb?.getAttribute('aria-valuetext')).toBe('100%')
  })
})
