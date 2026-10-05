// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_THEME, LIGHT_PALETTE, themeCss, type AppTheme, type ContrastWarning } from '@/lib/theme-vars'
import { saveAppTheme } from '@/lib/theme-actions'
import { AdminTheme, applyThemePreview } from './AdminTheme'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

// Il pannello incatena moduli 'use server' -> '@/lib/auth' -> next-auth, che
// l'ambiente di vitest non risolve: si stubbano i confini, come prima.
vi.mock('@/lib/theme-actions', () => ({ saveAppTheme: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const preview = () => document.getElementById('app-primary-preview')

const themeWith = (primaryColor: string, surfaces: Partial<AppTheme['surfaces']> = {}): AppTheme => ({
  primaryColor,
  surfaces: { light: {}, dark: {}, ...surfaces },
})

/**
 * L'anteprima dal vivo (specifica §4): un `<style id="app-primary-preview">` in
 * fondo a <head> con colore principale e superfici di tutti e due i modi, cosi'
 * un cambio di modo (anche del sistema operativo) non la lascia a meta'. `null`
 * lo toglie.
 */
describe('applyThemePreview', () => {
  afterEach(() => {
    preview()?.remove()
    document.head.replaceChildren()
  })

  it('writes both modes, with selectors that outweigh the layout style', () => {
    const theme = themeWith('#4f46e5', { light: { card: '#fafafa' } })
    applyThemePreview(document, theme)
    expect(preview()?.tagName).toBe('STYLE')
    expect(preview()?.textContent).toBe(themeCss(theme, '[data-theme-mode]'))
    expect(preview()?.textContent).toContain('html:root[data-theme-mode]{')
    expect(preview()?.textContent).toContain('html.dark[data-theme-mode]{')
    expect(preview()?.textContent).toContain('--card:#fafafa')
  })

  it('sits at the end of <head>, after the layout style', () => {
    document.head.append(document.createElement('style'))
    applyThemePreview(document, themeWith('#4f46e5'))
    document.head.append(document.createElement('link'))
    applyThemePreview(document, themeWith('#16a34a'))
    expect(document.head.lastElementChild).toBe(preview())
    expect(document.querySelectorAll('#app-primary-preview')).toHaveLength(1)
  })

  it('updates the same element when the theme changes', () => {
    applyThemePreview(document, themeWith('#4f46e5'))
    applyThemePreview(document, themeWith('#4f46e5', { dark: { sidebar: '#0b1220' } }))
    expect(document.querySelectorAll('#app-primary-preview')).toHaveLength(1)
    expect(preview()?.textContent).toContain('--sidebar:#0b1220')
  })

  it('removes the preview so the server-rendered theme shows again', () => {
    applyThemePreview(document, themeWith('#4f46e5'))
    applyThemePreview(document, null)
    expect(preview()).toBeNull()
  })

  it('never writes an inline --primary on <html>', () => {
    applyThemePreview(document, themeWith('#4f46e5'))
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })
})

describe('AdminTheme', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  beforeEach(() => {
    vi.mocked(saveAppTheme).mockReset()
    mocks.refresh.mockReset()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
    document.body.replaceChildren()
  })

  function render(savedTheme: AppTheme) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(createElement(AdminTheme, { savedTheme })))
  }

  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement
  const pick = (testId: string, value: string) => {
    const input = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('installs the preview only for a theme that is not the saved one, and drops it on leaving', () => {
    render(themeWith('#16a34a'))
    expect(preview()).toBeNull()

    act(() => button('theme.actions.reset_defaults').click())
    expect(preview()?.textContent).toBe(themeCss(DEFAULT_APP_THEME, '[data-theme-mode]'))
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')

    act(() => root?.unmount())
    root = undefined
    expect(preview()).toBeNull()
  })

  it('previews a surface picked in the strip, live', () => {
    render(DEFAULT_APP_THEME)
    pick('theme-preview-light-surface-input', '#F8FAFC')
    expect(preview()?.textContent).toContain('--card:#f8fafc;--popover:#f8fafc')
    expect(document.querySelector('[data-testid="theme-preview-light-surface-marker"]')).not.toBeNull()
  })

  it('resets the primary colour and every surface on "Valori di Default"', () => {
    render(themeWith('#16a34a', { light: { card: '#fafafa' }, dark: { sidebar: '#0b1220' } }))
    expect(document.querySelectorAll('[data-testid$="-marker"]')).toHaveLength(2)
    act(() => button('theme.actions.reset_defaults').click())
    expect(document.querySelectorAll('[data-testid$="-marker"]')).toHaveLength(0)
    expect(preview()?.textContent).toContain(`--card:${LIGHT_PALETTE.card}`)
  })

  it('saves straight away when nothing reads badly, then refreshes the layout style', async () => {
    vi.mocked(saveAppTheme).mockResolvedValue({ saved: true, error: null })
    render(DEFAULT_APP_THEME)
    pick('theme-preview-light-surface-input', '#f8fafc')
    await act(async () => button('common.actions.save').click())
    expect(saveAppTheme).toHaveBeenCalledWith(themeWith('#4f46e5', { light: { card: '#f8fafc' } }), { acknowledgeWarnings: false })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('theme.status.saved')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  describe('contrast warning', () => {
    const warnings: ContrastWarning[] = [
      { mode: 'light', text: 'foreground', surface: 'card', ratio: 1.2085 },
      { mode: 'light', text: 'primary', surface: null, ratio: null },
    ]

    async function saveWithWarnings() {
      vi.mocked(saveAppTheme).mockResolvedValueOnce({ saved: false, error: null, warnings })
      render(DEFAULT_APP_THEME)
      pick('theme-preview-light-surface-input', '#1f2937')
      await act(async () => button('common.actions.save').click())
      return document.querySelector('[role="dialog"]')
    }

    it('lists the problems in a dialog instead of saving', async () => {
      const dialog = await saveWithWarnings()
      expect(dialog).not.toBeNull()
      expect(dialog!.textContent).toContain('theme.warning.title')
      const items = Array.from(dialog!.querySelectorAll('li')).map(li => li.textContent)
      expect(items).toEqual([
        `theme.warning.item ${JSON.stringify({ text: 'theme.text.foreground', surface: 'theme.preview.swatch.surface', mode: 'theme.mode.light', ratio: 1.2 })}`,
        `theme.warning.primary ${JSON.stringify({ text: 'theme.section.primary_color', mode: 'theme.mode.light' })}`,
      ])
      expect(mocks.refresh).not.toHaveBeenCalled()
      expect(document.querySelector('[role="status"]')?.textContent).not.toBe('theme.status.saved')
    })

    it('saves nothing on "Annulla"', async () => {
      await saveWithWarnings()
      act(() => button('common.actions.cancel').click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(saveAppTheme).toHaveBeenCalledTimes(1)
      expect(mocks.refresh).not.toHaveBeenCalled()
      // L'anteprima resta: l'admin torna a modificare i colori.
      expect(preview()?.textContent).toContain('--card:#1f2937')
    })

    it('saves with the acknowledgement on "Salva comunque"', async () => {
      await saveWithWarnings()
      vi.mocked(saveAppTheme).mockResolvedValueOnce({ saved: true, error: null })
      await act(async () => button('theme.warning.confirm').click())
      expect(saveAppTheme).toHaveBeenLastCalledWith(
        themeWith('#4f46e5', { light: { card: '#1f2937' } }), { acknowledgeWarnings: true },
      )
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.refresh).toHaveBeenCalledOnce()
    })
  })
})
