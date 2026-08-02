// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CustomSelect from './CustomSelect'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

const options = [
  { value: 'first', label: 'First option' },
  { value: 'middle', label: 'Middle option' },
  { value: 'last', label: 'Last option' },
]

function renderSelect({
  value = 'middle',
  onChange = vi.fn(),
  selectOptions = options,
}: {
  value?: string
  onChange?: ReturnType<typeof vi.fn>
  selectOptions?: typeof options
} = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <CustomSelect
        ariaLabel="Choose an option"
        data-testid="custom-select"
        value={value}
        onChange={onChange}
        options={selectOptions}
      />,
    )
  })

  return {
    onChange,
    trigger: container.querySelector('[data-testid="custom-select"]') as HTMLButtonElement,
  }
}

function pressKey(target: Element, key: string) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('CustomSelect', () => {
  it('exposes listbox trigger and selected option semantics', () => {
    const { trigger } = renderSelect()

    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    act(() => trigger.click())

    const listbox = container?.querySelector('[role="listbox"]') as HTMLElement
    const renderedOptions = listbox.querySelectorAll('[role="option"]')
    expect(listbox.getAttribute('aria-activedescendant')).toBe(renderedOptions[1].id)
    expect(renderedOptions).toHaveLength(3)
    expect(renderedOptions[0].getAttribute('aria-selected')).toBe('false')
    expect(renderedOptions[1].getAttribute('aria-selected')).toBe('true')
    expect(renderedOptions[2].getAttribute('aria-selected')).toBe('false')
  })

  it('opens with ArrowDown, selects the last option with End and Enter, then restores trigger focus', () => {
    const onChange = vi.fn()
    const { trigger } = renderSelect({ onChange })
    trigger.focus()

    pressKey(trigger, 'ArrowDown')

    const listbox = container?.querySelector('[role="listbox"]') as HTMLElement
    expect(document.activeElement).toBe(listbox)
    pressKey(listbox, 'End')
    const lastOption = listbox.querySelectorAll('[role="option"]')[2]
    expect(listbox.getAttribute('aria-activedescendant')).toBe(lastOption.id)

    pressKey(listbox, 'Enter')

    expect(onChange).toHaveBeenCalledWith('last')
    expect(container?.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes with Escape without selecting and restores trigger focus', () => {
    const onChange = vi.fn()
    const { trigger } = renderSelect({ onChange })
    trigger.focus()
    pressKey(trigger, 'ArrowDown')

    const listbox = container?.querySelector('[role="listbox"]') as HTMLElement
    pressKey(listbox, 'Escape')

    expect(onChange).not.toHaveBeenCalled()
    expect(container?.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('does not open a popup when there are no options', () => {
    const { trigger } = renderSelect({ selectOptions: [] })

    act(() => trigger.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container?.querySelector('[role="listbox"]')).toBeNull()
  })
})
