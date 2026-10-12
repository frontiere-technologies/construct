// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// Il modulo vero e' una server action: arriva al database, che qui non c'e'.
vi.mock('@/lib/rbac/roles-actions', () => ({ createRole: vi.fn(), renameRole: vi.fn() }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function render(element: React.ReactElement): HTMLInputElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return document.querySelector('input')!
}

/**
 * Il nome di un ruolo non e' un dato personale, ma il segnaposto «Nome ruolo» e il focus
 * automatico all'apertura facevano comparire subito il menu di riempimento di Bitwarden, che
 * lo scambiava per il «nome» di un'identita'. Ora ci pensa la primitiva `Input` (riempimento
 * spento se il campo non dichiara che cosa contiene): questo test resta come prova sul caso reale.
 */
describe('role name fields and password managers', () => {
  it.each([
    ['create', <CreateRoleModal key="create" onClose={() => {}} />],
    ['rename', <RenameRoleModal key="rename" roleId={7} currentName="Lettore" onClose={() => {}} />],
  ])('keeps the %s field out of autofill', (_mode, element) => {
    const input = render(element)

    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.hasAttribute('data-bwignore'), 'Bitwarden propone ancora il riempimento').toBe(true)
  })
})
