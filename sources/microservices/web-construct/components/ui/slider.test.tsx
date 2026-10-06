// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Slider } from './slider'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

describe('Slider', () => {
  it('renders a slider thumb carrying its value and bounds', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => root.render(<Slider min={90} max={130} step={10} value={[110]} aria-label="Dimensione" />))
    const thumb = container.querySelector('[role="slider"]')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('110')
    expect(thumb?.getAttribute('aria-valuemin')).toBe('90')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('130')
    act(() => root.unmount())
    container.remove()
  })

  it('draws the track with the switch-off colour, not the invisible --muted', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Slider value={[50]} />))
    expect(container.querySelector('[data-slot="slider-track"]')?.className).toContain('bg-switch-off')
    act(() => root.unmount())
  })

  it('carries thumbLabel onto the slider thumb, where the accessible name belongs', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Slider value={[50]} thumbLabel="Dimensione del testo" />))
    expect(container.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('Dimensione del testo')
    act(() => root.unmount())
  })

  it('carries thumbValueText onto the slider thumb as aria-valuetext', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Slider value={[110]} min={90} max={130} thumbValueText="110%" />))
    expect(container.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')).toBe('110%')
    act(() => root.unmount())
  })

  it('fills the thumb with the primary colour, ringed in the card colour, so it shows on a dark card', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Slider value={[50]} />))
    const className = container.querySelector('[data-slot="slider-thumb"]')?.className ?? ''
    expect(className).toContain('bg-primary')
    expect(className).toContain('border-card')
    expect(className).not.toContain('bg-background')
    act(() => root.unmount())
  })
})
