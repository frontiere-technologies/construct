// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserDto } from '@/lib/rbac/types'
import ManageRolesModal from './ManageRolesModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
// Il modulo vero e' una server action: arriva al database, che qui non c'e'.
vi.mock('@/lib/rbac/users-actions', () => ({ updateUserRoles: vi.fn() }))

// Lunga quanto le email che la suite E2E semina davvero, e senza spazi: e'
// proprio l'assenza di spazi a non offrire nessun punto in cui andare a capo.
const LONG_EMAIL = 'e2e-register-b37c7d583d1c4039bafc70eb7dba4706@frontiere.io'

const user: UserDto = {
  id: 'u1',
  firstName: null,
  lastName: null,
  email: LONG_EMAIL,
  createdAt: '2026-08-24',
  updatedAt: null,
  roles: [],
  status: { idUserStatus: 2, description: 'Active' },
  tenantValidationPending: false,
  multiTenancyEnabled: false,
}

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ManageRolesModal user={user} allRoles={[]} onClose={() => {}} onSaved={() => {}} />,
  ))
  return container
}

/**
 * jsdom non fa layout, quindi si prova la classe che produce il comportamento.
 * Il titolo e la X stanno in una riga flex: senza `min-w-0` il titolo ha
 * `min-width: auto` e si rifiuta di stringersi sotto il proprio contenuto, e
 * senza `break-words` un'email non ha nessuno spazio su cui andare a capo. Le
 * due cose insieme mandavano il testo oltre il bordo del pannello, sopra la X.
 * Stesso difetto gia' chiuso su NavigationTree e sul pannello utente della
 * Sidebar; qui il titolo va a capo invece di troncare, perche' e' l'identita'
 * dell'utente di cui si stanno per cambiare i ruoli.
 */
describe('manage roles modal truncation', () => {
  it('lets the title shrink and wrap below its own text', () => {
    const el = render()
    const title = el.querySelector<HTMLElement>('h2')

    expect(title, 'il titolo del dialogo non e\' stato reso').not.toBe(null)
    expect(title!.textContent).toContain(LONG_EMAIL)
    expect(title!.classList.contains('min-w-0'), 'al titolo manca min-w-0').toBe(true)
    expect(title!.classList.contains('break-words'), 'al titolo manca break-words').toBe(true)
  })

  it('keeps the close button at its own width', () => {
    const el = render()
    const close = el.querySelector<HTMLElement>('[aria-label="common.actions.close"]')

    expect(close, 'il bottone di chiusura non e\' stato reso').not.toBe(null)
    expect(close!.classList.contains('shrink-0'), 'al bottone di chiusura manca shrink-0').toBe(true)
  })
})
