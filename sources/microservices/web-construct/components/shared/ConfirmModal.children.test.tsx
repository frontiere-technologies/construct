// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmModal } from './ConfirmModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function render(children?: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ConfirmModal title="Avviso" message="Sicuro?" onConfirm={() => {}} onCancel={() => {}}>
      {children}
    </ConfirmModal>,
  ))
  return document.querySelector('[role="dialog"]')!
}

/**
 * Un messaggio di una riga non basta a ogni conferma: l'avviso di contrasto
 * della pagina Tema elenca i problemi uno per uno. Il contenuto in piu' sta
 * sotto il messaggio, dentro il dialogo, e non cambia nient'altro.
 */
describe('confirm modal extra content', () => {
  it('renders children under the message, inside the dialog', () => {
    const dialog = render(<ul data-testid="extra"><li>uno</li></ul>)
    const message = dialog.querySelector('p')!
    const extra = dialog.querySelector('[data-testid="extra"]')
    expect(extra?.textContent).toBe('uno')
    expect(message.compareDocumentPosition(extra!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Il pulsante di conferma resta l'ultimo elemento del dialogo.
    expect(extra!.compareDocumentPosition(dialog.querySelector('button')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders nothing extra without children', () => {
    const dialog = render()
    expect(dialog.querySelector('ul')).toBeNull()
  })
})
