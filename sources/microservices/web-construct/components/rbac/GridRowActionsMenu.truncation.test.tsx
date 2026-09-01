// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ICellRendererParams } from 'ag-grid-community'
import GridRowActionsMenu, { type GridRowActionsMenuParams } from './GridRowActionsMenu'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

interface Row { id: number }

// Row-action labels come from Admin -> Translations, so their length is whatever
// a translator typed. Italian is already the long case in the shipped catalogue
// ("Imposta come predefinita"); another language can be longer still.
const LABELS = ['Modifica', 'Disattiva', 'Imposta come predefinita', 'Elimina']

let root: Root | undefined
let container: HTMLDivElement | undefined

function openMenu() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const params = {
    data: { id: 1 },
    node: { id: '1' },
    getItems: () => LABELS.map(label => ({ label, onClick: () => {} })),
  } as unknown as GridRowActionsMenuParams<Row> & ICellRendererParams<Row>

  act(() => root?.render(<GridRowActionsMenu<Row> {...params} />))
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="row-menu-1"]')!
  act(() => trigger.click())
  // The menu is portalled to document.body, not into the cell.
  return document.querySelector<HTMLElement>('.fixed.z-50')!
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

/**
 * jsdom does no layout, so these assert the classes that produce the behaviour.
 * The trap being guarded: `buttonVariants` puts `whitespace-nowrap` on every
 * Button, so a label longer than the menu box does not wrap — it spills out of
 * the popup. And because Button is `inline-flex`, `truncate` on the Button
 * itself is unreliable (the bare text becomes an anonymous flex item, which
 * text-overflow does not apply to), hence the assertion that the label sits in
 * its own truncating element.
 */
describe('row actions menu truncation', () => {
  it('gives every label its own truncating box', () => {
    const menu = openMenu()
    const labels = Array.from(menu.querySelectorAll('button')).map(b => b.querySelector('span'))

    expect(labels.length).toBe(LABELS.length)
    for (const [i, span] of labels.entries()) {
      expect(span, `la voce "${LABELS[i]}" non ha un elemento proprio`).not.toBeNull()
      expect(span!.textContent).toBe(LABELS[i])
      expect(span!.classList.contains('truncate'), `"${LABELS[i]}" non tronca`).toBe(true)
    }
  })

  it('caps the popup width instead of fixing it, so a longer translation fits', () => {
    const menu = openMenu()
    const classes = Array.from(menu.classList)

    expect(classes.some(c => /^max-w-/.test(c)), 'il menu non ha un tetto di larghezza').toBe(true)
    expect(classes.some(c => /^w-\d/.test(c)), 'il menu ha ancora una larghezza fissa').toBe(false)
  })
})
