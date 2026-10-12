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

/**
 * Il messaggio riporta spesso un nome scelto da chi usa l'app («Eliminare "<nome>" e tutti i
 * suoi figli?»), e un nome senza spazi non offre al browser nessun punto dove andare a capo:
 * con l'a capo normale usciva dal bordo del dialogo, largo al massimo `max-w-md`. jsdom non
 * misura il layout, quindi qui si controlla la classe che lo impedisce; l'effetto vero è
 * verificato nel browser.
 */
describe('confirm modal long words', () => {
  it('lets an unbroken name in the message wrap inside the dialog', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <ConfirmModal
        title="Elimina"
        message={`Eliminare "Test${'1'.repeat(80)}" e tutti i suoi figli?`}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ))

    const describedBy = document.querySelector('[aria-describedby]')?.getAttribute('aria-describedby')
    const message = describedBy ? document.getElementById(describedBy) : null
    expect(message, 'il messaggio del dialogo non è stato trovato').not.toBeNull()
    expect(message?.className, 'il messaggio non spezza le parole troppo lunghe').toContain('break-words')
  })
})
