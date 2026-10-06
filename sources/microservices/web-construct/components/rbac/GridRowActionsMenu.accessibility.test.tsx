// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ICellRendererParams } from 'ag-grid-community'
import GridRowActionsMenu, { type GridRowActionsMenuParams } from './GridRowActionsMenu'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.scrollIntoView ??= () => {}

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

interface Row { id: number }

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function mount(items = [
  { label: 'Modifica', onClick: () => {} },
  { label: 'Elimina', onClick: () => {} },
  { label: 'Disattiva', onClick: () => {}, disabled: true },
]) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const params = {
    data: { id: 1 },
    node: { id: '1' },
    getItems: () => items,
  } as unknown as GridRowActionsMenuParams<Row> & ICellRendererParams<Row>

  act(() => root?.render(<GridRowActionsMenu<Row> {...params} />))
  return container.querySelector<HTMLButtonElement>('[data-testid="row-menu-1"]')!
}

const press = (el: Element, key: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })

/**
 * A11Y-2. Il menu azioni di riga apriva un elenco di bottoni: nessun
 * `role="menu"`, nessun `role="menuitem"`, nessuna navigazione con le frecce,
 * nessun Escape. Il componente dichiarava la mancanza in un commento e ometteva
 * `aria-haspopup` di proposito, perche' annunciare un menu che non esiste e'
 * peggio che non annunciare niente.
 *
 * Adesso il menu e' vero, quindi l'annuncio deve esserci ed essere esatto. Questi
 * test difendono il contratto — i ruoli **insieme** alla tastiera che promettono —
 * non l'implementazione: se un giorno Radix venisse sostituito, devono continuare
 * a valere.
 */
describe('row actions menu accessibility', () => {
  it('announces a menu, now that it really is one', () => {
    const trigger = mount()

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    press(trigger, 'Enter')

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="menu"]'), 'nessun role="menu"').not.toBeNull()
  })

  it('opens from the keyboard and exposes every action as a menu item', () => {
    press(mount(), 'Enter')

    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    expect(items.map(i => i.textContent)).toEqual(['Modifica', 'Elimina', 'Disattiva'])
  })

  it('marks a disabled action disabled instead of merely greying it', () => {
    press(mount(), 'Enter')

    const disabled = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find(i => i.textContent === 'Disattiva')!
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const trigger = mount()
    press(trigger, 'Enter')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    press(document.querySelector('[role="menu"]')!, 'Escape')
    // Radix restituisce il fuoco dopo lo smontaggio dello strato, non dentro
    // lo stesso giro sincrono: senza questo flush si misurerebbe troppo presto.
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    expect(document.querySelector('[role="menu"]'), 'Escape non ha chiuso il menu').toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement, 'il fuoco non e\' tornato sul grilletto').toBe(trigger)
  })
})
