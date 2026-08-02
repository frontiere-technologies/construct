// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccessibleDialog from './AccessibleDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

function renderDialog({
  busy = false,
  onClose = vi.fn(),
  children,
}: {
  busy?: boolean
  onClose?: ReturnType<typeof vi.fn>
  children?: React.ReactNode
} = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <AccessibleDialog titleId="dialog-title" onClose={onClose} busy={busy}>
        {children ?? <>
          <h2 id="dialog-title">Title</h2>
          <button data-dialog-initial-focus>Cancel</button>
          <button>Save</button>
        </>}
      </AccessibleDialog>,
    )
  })

  return { onClose, dialog: container.querySelector('[role="dialog"]') as HTMLDivElement }
}

function pressKey(target: Element, key: string, options: KeyboardEventInit = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('AccessibleDialog', () => {
  it('exposes modal dialog semantics and focuses its marked initial control', () => {
    const { dialog } = renderDialog()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('dialog-title')
    expect(document.activeElement).toBe(dialog.querySelector('[data-dialog-initial-focus]'))
  })

  it('wraps Tab focus from the last focusable control to the first', () => {
    const { dialog } = renderDialog()
    const buttons = dialog.querySelectorAll('button')
    buttons[1].focus()

    pressKey(dialog, 'Tab')

    expect(document.activeElement).toBe(buttons[0])
  })

  it('wraps Shift+Tab focus from the first focusable control to the last', () => {
    const { dialog } = renderDialog()
    const buttons = dialog.querySelectorAll('button')
    buttons[0].focus()

    pressKey(dialog, 'Tab', { shiftKey: true })

    expect(document.activeElement).toBe(buttons[1])
  })

  it('closes on an unmodified Escape key', () => {
    const { dialog, onClose } = renderDialog()

    pressKey(dialog, 'Escape')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on modified Escape or while busy', () => {
    const normal = renderDialog()
    pressKey(normal.dialog, 'Escape', { ctrlKey: true })
    expect(normal.onClose).not.toHaveBeenCalled()
    act(() => root?.unmount())
    container?.remove()

    const busy = renderDialog({ busy: true })
    pressKey(busy.dialog, 'Escape')
    expect(busy.onClose).not.toHaveBeenCalled()
  })

  it('suppresses marked internal close controls while busy', () => {
    const onClose = vi.fn()
    const { dialog } = renderDialog({
      busy: true,
      onClose,
      children: <>
        <h2 id="dialog-title">Title</h2>
        <button data-dialog-initial-focus data-dialog-close onClick={onClose}>Cancel</button>
        <button>Save</button>
      </>,
    })

    act(() => (dialog.querySelector('[data-dialog-close]') as HTMLButtonElement).click())

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only when the backdrop itself is clicked and is not busy', () => {
    const { dialog, onClose } = renderDialog()
    const backdrop = dialog.parentElement as HTMLDivElement

    act(() => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    act(() => backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    container?.remove()

    const busy = renderDialog({ busy: true })
    act(() => (busy.dialog.parentElement as HTMLDivElement).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(busy.onClose).not.toHaveBeenCalled()
  })

  it('restores focus to the connected trigger after unmount', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    renderDialog()

    act(() => root?.unmount())

    expect(document.activeElement).toBe(trigger)
  })
})
