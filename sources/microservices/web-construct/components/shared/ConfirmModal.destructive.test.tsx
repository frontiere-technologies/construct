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

function render(props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ConfirmModal
      title="Elimina"
      message="Sicuro?"
      confirmLabel="Elimina"
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  ))
  // Il bottone di conferma e' l'ultimo: Annulla porta data-dialog-close.
  const buttons = Array.from(container.querySelectorAll('button'))
  return buttons[buttons.length - 1]
}

/**
 * Il bottone che conferma una cancellazione era del colore primario, identico a
 * quello che conferma un'azione qualunque: la variante `destructive` esisteva in
 * `buttonVariants` senza nessun punto d'uso. Il segnale sta sul dialogo e non sul
 * chiamante perche' i punti d'uso sono sei e solo quattro sono cancellazioni.
 */
describe('confirm modal destructive intent', () => {
  it('paints the confirm button destructive when the action destroys something', () => {
    const confirm = render({ destructive: true })
    expect(confirm.className, 'la conferma non usa la variante destructive').toContain('bg-destructive')
    expect(confirm.className).toContain('text-destructive-foreground')
  })

  it('leaves an ordinary confirmation on the primary colour', () => {
    const confirm = render()
    expect(confirm.className, 'una conferma non distruttiva non deve diventare rossa').toContain('bg-primary')
    expect(confirm.className).not.toContain('bg-destructive')
  })
})
