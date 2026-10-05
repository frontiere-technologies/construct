// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_THEME, derivePrimary, type AppTheme } from '@/lib/theme-vars'
import { PalettePreview, type PalettePreviewLabels } from './PalettePreview'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const labels: PalettePreviewLabels = {
  light: 'Chiaro', dark: 'Scuro', primary: 'Principale', hover: 'Passaggio',
  surface: 'Superficie', background: 'Sfondo', sidebar: 'Sidebar',
  modeLight: 'chiaro', modeDark: 'scuro', customised: 'Personalizzato',
  cellName: ({ surface, mode, color, customised }) =>
    `${surface}, ${mode}: ${color}${customised ? ' — personalizzato' : ''}, modifica`,
}

const themeWith = (surfaces: Partial<AppTheme['surfaces']>): AppTheme => ({
  ...DEFAULT_APP_THEME,
  surfaces: { light: {}, dark: {}, ...surfaces },
})

describe('PalettePreview', () => {
  it('paints each mode with its own primary pair and fixed palette', () => {
    const derived = derivePrimary('#4f46e5')!
    const html = renderToStaticMarkup(<PalettePreview theme={DEFAULT_APP_THEME} labels={labels} />)
    expect(html).toContain('data-testid="theme-preview-light"')
    expect(html).toContain('data-testid="theme-preview-dark"')
    expect(html).toMatch(/data-testid="theme-preview-light-primary"[^>]*background-color:#4f46e5;color:#ffffff/)
    expect(html).toMatch(new RegExp(`data-testid="theme-preview-dark-primary"[^>]*background-color:${derived.dark.primary}`))
    expect(html).toMatch(/data-testid="theme-preview-dark-background"[^>]*background-color:#030712/)
  })

  it('paints a changed surface with its colour, in its own mode only', () => {
    const html = renderToStaticMarkup(<PalettePreview theme={themeWith({ light: { card: '#fafafa' } })} labels={labels} />)
    expect(html).toMatch(/data-testid="theme-preview-light-surface"[^>]*background-color:#fafafa/)
    expect(html).toMatch(/data-testid="theme-preview-dark-surface"[^>]*background-color:#1f2937/)
  })

  it('stays read-only without a change handler', () => {
    const html = renderToStaticMarkup(<PalettePreview theme={DEFAULT_APP_THEME} labels={labels} />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('type="color"')
  })
})

describe('PalettePreview editing', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  function render(theme: AppTheme = DEFAULT_APP_THEME, onSurfaceChange = vi.fn(), disabled = false) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <PalettePreview theme={theme} labels={labels} onSurfaceChange={onSurfaceChange} disabled={disabled} />,
    ))
    return onSurfaceChange
  }

  const cell = (id: string) => container!.querySelector(`[data-testid="theme-preview-${id}"]`) as HTMLButtonElement
  const input = (id: string) => container!.querySelector(`[data-testid="theme-preview-${id}-input"]`) as HTMLInputElement
  const keydown = (el: Element, key: string) =>
    act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })

  it('makes the four surfaces of both modes buttons, and leaves the primary alone', () => {
    render()
    for (const mode of ['light', 'dark']) {
      for (const key of ['hover', 'surface', 'background', 'sidebar']) {
        expect(cell(`${mode}-${key}`).tagName).toBe('BUTTON')
      }
      expect(cell(`${mode}-primary`).tagName).toBe('DIV')
    }
  })

  it('names each cell with its surface, mode and colour', () => {
    render()
    expect(cell('light-surface').getAttribute('aria-label')).toBe('Superficie, chiaro: #ffffff, modifica')
    expect(cell('dark-sidebar').getAttribute('aria-label')).toBe('Sidebar, scuro: #111827, modifica')
  })

  it('opens the native picker on a pointer click', () => {
    render()
    const click = vi.spyOn(input('light-surface'), 'click')
    act(() => { cell('light-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })) })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('opens the native picker on Enter and exactly once on Space', () => {
    render()
    const click = vi.spyOn(input('dark-background'), 'click')
    keydown(cell('dark-background'), 'Enter')
    keydown(cell('dark-background'), ' ')
    // Il click sintetico al rilascio di Spazio ha detail 0 e non apre una seconda volta.
    act(() => cell('dark-background').click())
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('reports the picked colour in lower case with its mode and surface', () => {
    const onSurfaceChange = render()
    const picker = input('dark-hover')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, '#ABCDEF')
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onSurfaceChange).toHaveBeenCalledWith('dark', 'accent', '#abcdef')
  })

  it('marks a changed surface and says so in its name', () => {
    render(themeWith({ light: { card: '#fafafa' } }))
    expect(cell('light-surface').getAttribute('aria-label')).toBe('Superficie, chiaro: #fafafa — personalizzato, modifica')
    expect(container!.querySelector('[data-testid="theme-preview-light-surface-marker"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="theme-preview-dark-surface-marker"]')).toBeNull()
    expect(container!.querySelector('[data-testid="theme-preview-light-background-marker"]')).toBeNull()
  })

  it('disables the cells and the pickers while disabled', () => {
    render(DEFAULT_APP_THEME, vi.fn(), true)
    expect(cell('light-surface').disabled).toBe(true)
    expect(input('light-surface').disabled).toBe(true)
  })
})
