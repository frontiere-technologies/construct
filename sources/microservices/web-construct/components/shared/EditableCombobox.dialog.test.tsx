// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccessibleDialog } from './AccessibleDialog'
import { EditableCombobox } from './EditableCombobox'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Il combobox da solo non basta a provare questo: l'Escape che chiude la lista
 * e' lo stesso tasto con cui AccessibleDialog chiude la modale, e il difetto
 * vive nel pezzo di strada fra i due. Provato ognuno per conto suo, il campo
 * "chiude la lista" e la modale "chiude su Escape" passavano entrambi mentre
 * insieme buttavano via la form compilata.
 */
const OPTIONS = ['auth', 'common', 'nav', 'theme', 'translation']

let root: Root | undefined
let container: HTMLDivElement | undefined

function renderDialogWithCombobox(options: string[] = OPTIONS) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const onClose = vi.fn()
  const onChange = vi.fn()

  act(() => root?.render(
    <AccessibleDialog titleId="dialog-title" onClose={onClose} panelClassName="">
      <h2 id="dialog-title">Nuova chiave</h2>
      <EditableCombobox id="ns" value="" onChange={onChange} options={options} data-testid="ns" />
    </AccessibleDialog>,
  ))

  const input = container.querySelector<HTMLInputElement>('[data-testid="ns"]')!
  return { input, onClose, onChange }
}

const listbox = () => container?.querySelector<HTMLElement>('[role="listbox"]') ?? null

const pressEscape = (input: HTMLInputElement) => act(() => {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('EditableCombobox inside AccessibleDialog', () => {
  it('dismisses only the suggestion list, leaving the dialog open', () => {
    const { input, onClose } = renderDialogWithCombobox()
    // La modale mette a fuoco il primo controllo focalizzabile, che qui e' il campo.
    expect(document.activeElement).toBe(input)
    expect(listbox()).not.toBeNull()

    pressEscape(input)

    expect(listbox()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes the dialog when Escape arrives with the list already closed', () => {
    const { input, onClose } = renderDialogWithCombobox()
    pressEscape(input)
    expect(listbox()).toBeNull()

    pressEscape(input)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog on Escape when there is nothing to suggest at all', () => {
    const { input, onClose } = renderDialogWithCombobox([])

    pressEscape(input)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
