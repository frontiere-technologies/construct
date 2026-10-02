// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorSwatches, type SwatchOption } from './ColorSwatches'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const options: SwatchOption[] = [
  { id: 'indigo', color: '#4f46e5', label: 'Indaco' },
  { id: 'green', color: '#059669', label: 'Verde' },
]

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(value: string, onChange = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ColorSwatches options={options} value={value} groupLabel="Colore" customLabel="Personalizzato" onChange={onChange} />,
  ))
  return onChange
}

const swatch = (id: string) => container!.querySelector(`[data-testid="theme-swatch-${id}"]`) as HTMLButtonElement

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('ColorSwatches', () => {
  it('checks the preset that matches the value and names every swatch', () => {
    render('#059669')
    expect(swatch('green').getAttribute('aria-checked')).toBe('true')
    expect(swatch('indigo').getAttribute('aria-checked')).toBe('false')
    expect(swatch('indigo').getAttribute('aria-label')).toBe('Indaco')
    expect(container!.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Colore')
  })

  it('checks the custom swatch, painted with the value, when no preset matches', () => {
    render('#123456')
    expect(swatch('custom').getAttribute('aria-checked')).toBe('true')
    expect(swatch('custom').style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(container!.querySelector('[data-testid="theme-primary-hex"]')?.textContent).toBe('#123456')
  })

  it('reports the colour of a clicked preset', () => {
    const onChange = render('#4f46e5')
    act(() => swatch('green').click())
    expect(onChange).toHaveBeenCalledWith('#059669')
  })

  it('reports a colour typed into the custom picker in lower case', () => {
    const onChange = render('#4f46e5')
    const input = container!.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#ABCDEF')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  it('opens the native picker when the custom swatch is clicked', () => {
    render('#4f46e5')
    const input = container!.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    act(() => swatch('custom').click())
    expect(click).toHaveBeenCalled()
  })

  it('disables every swatch and the picker while disabled', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <ColorSwatches options={options} value="#4f46e5" groupLabel="Colore" customLabel="Personalizzato" disabled onChange={vi.fn()} />,
    ))
    for (const id of ['indigo', 'green', 'custom']) expect(swatch(id).disabled).toBe(true)
    expect((container.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement).disabled).toBe(true)
  })
})
