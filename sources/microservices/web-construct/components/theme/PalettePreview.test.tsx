// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_THEME, derivePrimary, type AppTheme } from '@/lib/theme-vars'
import { PalettePreview, PRIMARY_TARGET, type PalettePreviewLabels, type ThemeTarget } from './PalettePreview'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const labels: PalettePreviewLabels = {
  light: 'Chiaro', dark: 'Scuro', primary: 'Principale', hover: 'Hover',
  surface: 'Superficie', background: 'Sfondo', sidebar: 'Sidebar',
  modeLight: 'chiaro', modeDark: 'scuro', customised: 'Personalizzato',
  cellName: ({ surface, mode, color, customised }) =>
    `${surface}, ${mode}: ${color}${customised ? ' — personalizzato' : ''}`,
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
    expect(html).toMatch(/data-testid="theme-cell-primary-light"[^>]*background-color:#4f46e5;color:#ffffff/)
    expect(html).toMatch(new RegExp(`data-testid="theme-cell-primary-dark"[^>]*background-color:${derived.dark.primary}`))
    expect(html).toMatch(/data-testid="theme-cell-dark-background"[^>]*background-color:#030712/)
  })

  it('paints a changed surface with its colour, in its own mode only', () => {
    const html = renderToStaticMarkup(<PalettePreview theme={themeWith({ light: { card: '#fafafa' } })} labels={labels} />)
    expect(html).toMatch(/data-testid="theme-cell-light-card"[^>]*background-color:#fafafa/)
    expect(html).toMatch(/data-testid="theme-cell-dark-card"[^>]*background-color:#1f2937/)
  })

  it('stays read-only without a selection handler', () => {
    const html = renderToStaticMarkup(<PalettePreview theme={DEFAULT_APP_THEME} labels={labels} />)
    expect(html).not.toContain('<button')
  })
})

describe('PalettePreview selection', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  function render(selected: ThemeTarget = PRIMARY_TARGET, theme: AppTheme = DEFAULT_APP_THEME, disabled = false) {
    const onSelect = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <PalettePreview theme={theme} labels={labels} selected={selected} onSelect={onSelect} disabled={disabled} />,
    ))
    return onSelect
  }

  const cell = (id: string) => container!.querySelector(`[data-testid="theme-cell-${id}"]`) as HTMLButtonElement
  const pressed = () => Array.from(container!.querySelectorAll('[aria-pressed="true"]')).map(el => el.getAttribute('data-testid'))

  it('makes every cell a toggle button, the primary ones included', () => {
    render()
    for (const mode of ['light', 'dark']) {
      for (const id of [`primary-${mode}`, `${mode}-accent`, `${mode}-card`, `${mode}-background`, `${mode}-sidebar`]) {
        expect(cell(id).tagName).toBe('BUTTON')
        expect(cell(id).hasAttribute('aria-pressed')).toBe(true)
      }
    }
    expect(container!.querySelector('input')).toBeNull()
  })

  it('selects the two primary cells separately: one pressed cell in total', () => {
    render(PRIMARY_TARGET)
    expect(pressed()).toEqual(['theme-cell-primary-light'])
    act(() => root?.unmount())
    container?.remove()
    render({ kind: 'primary', mode: 'dark' })
    expect(pressed()).toEqual(['theme-cell-primary-dark'])
  })

  it('shows a selected surface in its own strip only', () => {
    render({ kind: 'surface', mode: 'dark', key: 'sidebar' })
    expect(pressed()).toEqual(['theme-cell-dark-sidebar'])
  })

  it('reports the target of a clicked cell, also for a click without pointer', () => {
    const onSelect = render()
    act(() => cell('light-card').click())
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'surface', mode: 'light', key: 'card' })
    act(() => cell('primary-dark').click())
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'primary', mode: 'dark' })
    act(() => cell('primary-light').click())
    expect(onSelect).toHaveBeenLastCalledWith(PRIMARY_TARGET)
  })

  it('names each cell with its label, mode and colour', () => {
    render()
    expect(cell('light-card').getAttribute('aria-label')).toBe('Superficie, chiaro: #ffffff')
    expect(cell('dark-sidebar').getAttribute('aria-label')).toBe('Sidebar, scuro: #111827')
    expect(cell('primary-light').getAttribute('aria-label')).toBe('Principale, chiaro: #4f46e5')
  })

  it('marks a changed surface and says so in its name', () => {
    render(PRIMARY_TARGET, themeWith({ light: { card: '#fafafa' } }))
    expect(cell('light-card').getAttribute('aria-label')).toBe('Superficie, chiaro: #fafafa — personalizzato')
    expect(container!.querySelector('[data-testid="theme-cell-light-card-marker"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="theme-cell-dark-card-marker"]')).toBeNull()
    expect(container!.querySelector('[data-testid="theme-cell-light-background-marker"]')).toBeNull()
  })

  it('marks the dark primary cell when the dark primary is chosen', () => {
    render(PRIMARY_TARGET, { ...DEFAULT_APP_THEME, primaryDark: '#fbbf24' })
    expect(container!.querySelector('[data-testid="theme-cell-primary-dark-marker"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="theme-cell-primary-light-marker"]')).toBeNull()
    expect(cell('primary-dark').getAttribute('aria-label')).toBe('Principale, scuro: #fbbf24 — personalizzato')
  })

  it('draws every cell as a separate bordered button, and the selected one with an outer primary ring', () => {
    render({ kind: 'surface', mode: 'light', key: 'card' })
    for (const id of ['primary-light', 'light-card', 'dark-sidebar']) {
      const classes = cell(id).className.split(/\s+/)
      expect(classes).toEqual(expect.arrayContaining(['rounded-md', 'border', 'border-border']))
      expect(cell(id).style.outline).toBe('')
    }
    const selectedClasses = ['ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-card']
    expect(cell('light-card').className.split(/\s+/)).toEqual(expect.arrayContaining(selectedClasses))
    for (const c of selectedClasses) expect(cell('primary-light').className.split(/\s+/)).not.toContain(c)
    // Il contenitore non taglia l'anello: niente overflow-hidden, e spazio intorno alle celle.
    const strip = cell('light-card').parentElement!
    expect(strip.className).not.toContain('overflow-hidden')
    expect(strip.className.split(/\s+/)).toEqual(expect.arrayContaining(['gap-2', 'p-1']))
  })

  it('draws the keyboard focus inside the cell in its own text colour, readable on any cell', () => {
    render()
    for (const id of ['primary-light', 'light-card']) {
      expect(cell(id).className.split(/\s+/)).toEqual(expect.arrayContaining([
        'focus-visible:outline-2', 'focus-visible:-outline-offset-4', 'focus-visible:outline-current',
      ]))
      expect(cell(id).className).not.toContain('outline-ring')
    }
  })

  it('switches off the global hover lift and the disabled fade, which would fake another colour', () => {
    render()
    for (const id of ['light-card', 'primary-light']) {
      expect(cell(id).className.split(/\s+/)).toEqual(
        expect.arrayContaining(['enabled:hover:transform-none', 'enabled:hover:filter-none', 'disabled:filter-none']),
      )
    }
  })

  it('disables every cell while disabled', () => {
    render(PRIMARY_TARGET, DEFAULT_APP_THEME, true)
    expect(cell('light-card').disabled).toBe(true)
    expect(cell('primary-dark').disabled).toBe(true)
  })
})
