// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import PermissionsTree from './PermissionsTree'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Come in NavigationTree.truncation.test.tsx: il modulo vero arriva a next-auth,
// che l'ambiente di test non risolve.
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const nodo = (
  id: number,
  type: 'CATEGORY' | 'FUNCTIONALITY',
  children: UserNavigationTreeDto[] = [],
): UserNavigationTreeDto => ({
  id, name: `nodo-${id}`, type, parentId: null, authorization: false, children,
})

// Admin(5) > [6, 7];  AAA(4) contenitore vuoto
const trees: UserNavigationTreeDto[] = [
  nodo(5, 'CATEGORY', [nodo(6, 'FUNCTIONALITY'), nodo(7, 'FUNCTIONALITY')]),
  nodo(4, 'CATEGORY'),
]

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function draw(map: Map<number, boolean>, editable = true) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <PermissionsTree trees={trees} map={map} onChange={() => {}} editable={editable} />,
  ))
}

/** L'interruttore della riga il cui nodo si chiama `label`. Il componente mette il nome del
 *  nodo nell'`aria-label` proprio per rendere possibile questa ricerca. */
function toggle(label: string): HTMLButtonElement {
  const el = container?.querySelector<HTMLButtonElement>(
    `[data-testid="perm-toggle"][aria-label="${label}"]`,
  )
  if (!el) throw new Error(`interruttore non trovato: ${label}`)
  return el
}

describe('PermissionsTree, interruttore delle cartelle', () => {
  it('la cartella con tutte le foglie accese si mostra accesa', () => {
    draw(new Map([[6, true], [7, true]]))
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('true')
  })

  // BUG-2: prima l'interruttore di una cartella era permanentemente spento, qualunque cosa
  // ci fosse sotto — buildAuthTree le marcava authorization: false per costruzione.
  it('la cartella con alcune foglie accese si mostra a stato misto, non spenta', () => {
    draw(new Map([[6, true]]))
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('mixed')
  })

  it('la cartella senza foglie accese si mostra spenta', () => {
    draw(new Map())
    expect(toggle('nodo-5').getAttribute('aria-checked')).toBe('false')
  })

  // `role="switch"` non ammette aria-checked="mixed" (ARIA 1.2 lo riserva a checkbox e
  // menuitemcheckbox): una cartella porta tre valori, quindi porta l'altro ruolo.
  it('la cartella dichiara il ruolo che ammette i tre valori, la foglia quello a due', () => {
    draw(new Map())
    expect(toggle('nodo-5').getAttribute('role')).toBe('checkbox')
    expect(toggle('nodo-6').getAttribute('role')).toBe('switch')
  })

  it('il contenitore senza foglie nel sottoalbero è disabilitato, non inerte', () => {
    draw(new Map())
    expect(toggle('nodo-4').disabled).toBe(true)
    expect(toggle('nodo-4').getAttribute('title')).toBe('roles.detail.empty_container_hint')
  })

  it('la foglia resta un interruttore a due stati', () => {
    draw(new Map([[6, true]]))
    expect(toggle('nodo-6').getAttribute('aria-checked')).toBe('true')
    expect(toggle('nodo-7').getAttribute('aria-checked')).toBe('false')
  })

  it('tutti gli interruttori sono disabilitati quando l\'albero non è modificabile', () => {
    draw(new Map(), false)
    expect(toggle('nodo-6').disabled).toBe(true)
    expect(toggle('nodo-5').disabled).toBe(true)
  })
})
