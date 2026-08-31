// @vitest-environment jsdom

import React, { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableCombobox } from './EditableCombobox'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS = ['auth', 'common', 'nav', 'theme', 'translation']

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(value: string, onChange = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <EditableCombobox id="ns" value={value} onChange={onChange} options={OPTIONS} data-testid="ns" />,
  ))
  const input = container.querySelector<HTMLInputElement>('[data-testid="ns"]')!
  return { input, onChange }
}

const listbox = () => container?.querySelector<HTMLElement>('[role="listbox"]') ?? null
const optionTexts = () =>
  Array.from(container?.querySelectorAll('[role="option"]') ?? []).map(o => o.textContent)

// React keeps a value tracker on the DOM node: assigning `input.value = x`
// directly leaves the tracker thinking nothing changed, and onChange never
// fires. Going through the prototype's own setter is what React's own test
// utilities do, and it is the difference between this helper working and
// every typing test failing for a reason that looks nothing like the cause.
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

/** The component reads `value` from props, so typing means: fire input, then re-render. */
function type(input: HTMLInputElement, next: string, onChange: ReturnType<typeof vi.fn>) {
  act(() => {
    setNativeValue.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(onChange).toHaveBeenLastCalledWith(next)
  act(() => root?.render(
    <EditableCombobox id="ns" value={next} onChange={onChange} options={OPTIONS} data-testid="ns" />,
  ))
}

// The correction for a stale highlight used to run in a *passive* `useEffect`,
// which lands its state update in a follow-up render — after the DOM for the
// narrowing render is already live. A `useLayoutEffect` commits synchronously
// in that same first render, before any passive effect gets a chance to run,
// so this probe observes the exact intermediate DOM a browser (or a screen
// reader) would: the one where `matches` has already narrowed but nothing has
// corrected `active` yet.
function ActiveDescendantProbe({ input, onSnapshot }: { input: HTMLInputElement; onSnapshot: (id: string | null) => void }) {
  useLayoutEffect(() => { onSnapshot(input.getAttribute('aria-activedescendant')) })
  return null
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('EditableCombobox', () => {
  it('is closed until the field is focused', () => {
    const { input } = render('')
    expect(listbox()).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on focus listing every option', () => {
    const { input } = render('')
    act(() => input.focus())
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(optionTexts()).toEqual(OPTIONS)
  })

  it('filters by case-insensitive substring as the user types', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    // Upper-case needle against lower-case options, and a match in the middle
    // of the word rather than a prefix: 'th' is inside 'auth' as well as at the
    // start of 'theme'. Both properties are the point of the assertion.
    type(input, 'TH', onChange)
    expect(optionTexts()).toEqual(['auth', 'theme'])
  })

  it('closes and keeps the text when nothing matches', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    type(input, 'brand-new-namespace', onChange)
    expect(listbox()).toBeNull()
    expect(input.value).toBe('brand-new-namespace')
  })

  it('takes the highlighted option on Enter', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('common')
  })

  it('points aria-activedescendant at the highlighted option', () => {
    const { input } = render('')
    act(() => input.focus())
    const first = container!.querySelector('[role="option"]')!
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    const second = container!.querySelectorAll('[role="option"]')[1]
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id)
  })

  it('keeps aria-activedescendant naming a rendered option through the render that narrows the list', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    // Highlight the option at index 3 ('theme') while all 5 options show.
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))

    // Narrow to fewer options than the highlighted index — 'th' matches only
    // 'auth' and 'theme', so index 3 no longer exists in the rendered list —
    // and snapshot aria-activedescendant from inside that very render via the
    // probe's layout effect, before any passive effect can react to it.
    let snapshot: string | null = null
    act(() => root?.render(<>
      <EditableCombobox id="ns" value="th" onChange={onChange} options={OPTIONS} data-testid="ns" />
      <ActiveDescendantProbe input={input} onSnapshot={id => { snapshot = id }} />
    </>))

    expect(snapshot).not.toBeNull()
    const option = Array.from(container!.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(o => o.id === snapshot)
    // Assert against the rendered DOM, not an index: the id must resolve to
    // an option that actually exists, and it must be the one marked selected.
    expect(option).toBeDefined()
    expect(option!.getAttribute('aria-selected')).toBe('true')
  })

  it('writes the clicked option into the field and closes', () => {
    const { input, onChange } = render('')
    act(() => input.focus())
    const theme = Array.from(container!.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(o => o.textContent === 'theme')!
    act(() => theme.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('theme')
    expect(listbox()).toBeNull()
  })

  it('closes on Escape without changing the value', () => {
    const { input, onChange } = render('common')
    act(() => input.focus())
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(listbox()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it('scrolls rather than growing when the catalogue is long', () => {
    const { input } = render('')
    act(() => input.focus())
    const list = listbox()!
    expect(list.classList.contains('max-h-56')).toBe(true)
    expect(list.classList.contains('overflow-y-auto')).toBe(true)
  })

  it('renders as a plain field when there is nothing to suggest', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <EditableCombobox id="ns" value="" onChange={vi.fn()} options={[]} data-testid="ns" />,
    ))
    const input = container.querySelector<HTMLInputElement>('[data-testid="ns"]')!
    act(() => input.focus())
    expect(listbox()).toBeNull()
  })
})
