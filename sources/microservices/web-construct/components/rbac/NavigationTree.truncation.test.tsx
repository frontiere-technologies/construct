// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import NavigationTree from './NavigationTree'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Come in NavigationTree.test.ts: il modulo vero arriva a next-auth, che
// l'ambiente di test non risolve.
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

// I nomi dei nodi si scrivono in Admin -> Traduzioni: la loro lunghezza e' una
// scelta di chi traduce, non nostra.
const LONG = `Categoria${'a'.repeat(60)}`
const CHILD = `Funzionalita${'a'.repeat(60)}`

const nodes: UserNavigationTreeDto[] = [
  {
    id: 1, name: LONG, type: 'CATEGORY', parentId: null, authorization: true,
    children: [
      {
        id: 2, name: CHILD, type: 'FUNCTIONALITY', parentId: 1, authorization: true,
        children: [], functionalityType: 'EMBEDDED_PAGE',
      },
    ],
  },
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

/**
 * jsdom non fa layout, quindi si prova la classe che produce il comportamento.
 * Il nome del nodo sta in un figlio flex `flex-1`: senza `min-w-0` quel figlio
 * ha `min-width: auto` e si rifiuta di stringersi sotto il proprio contenuto,
 * cosi' una parola lunga allarga la riga e spinge fuori le azioni in coda
 * invece di finire in puntini. E' lo stesso difetto gia' chiuso sul pannello
 * utente della Sidebar.
 */
describe('navigation tree truncation', () => {
  it('lets every node name shrink below its own text', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<NavigationTree nodes={nodes} />))

    const labels = Array.from(container.querySelectorAll<HTMLElement>('span'))
      .filter(s => s.textContent === LONG || s.textContent === CHILD)

    expect(labels.length).toBe(2)
    for (const label of labels) {
      expect(label.classList.contains('min-w-0'), `"${label.textContent?.slice(0, 12)}" manca min-w-0`).toBe(true)
      expect(label.classList.contains('truncate'), `"${label.textContent?.slice(0, 12)}" manca truncate`).toBe(true)
    }
  })
})
