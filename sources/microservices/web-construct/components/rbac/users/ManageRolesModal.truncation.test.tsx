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

function render(
  allRoles: { id: number; name: string }[] = [],
  assignableRoleIds: number[] = [],
  target: UserDto = user,
  registeredRoleId = 0,
) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ManageRolesModal
      user={target} allRoles={allRoles} assignableRoleIds={assignableRoleIds} registeredRoleId={registeredRoleId}
      onClose={() => {}} onSaved={() => {}}
    />,
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

  // Un nome di ruolo lungo e senza spazi usciva dalla riga della lista: la lista scorreva in
  // orizzontale, lo sfondo dell'hover finiva a meta' (copre la riga, larga quanto la parte
  // visibile) e la casella di spunta usciva a sinistra. Il nome va a capo dentro la riga.
  it('wraps a long role name inside its row instead of scrolling the list sideways', () => {
    const longName = `Ruolo${'q'.repeat(90)}`
    const el = render([{ id: 7, name: longName }], [7])
    const box = el.querySelector<HTMLInputElement>('[data-testid="role-checkbox-7"]')
    const name = box?.closest('label')?.querySelector<HTMLElement>('span')

    expect(name?.textContent).toBe(longName)
    expect(name!.classList.contains('min-w-0'), 'al nome del ruolo manca min-w-0').toBe(true)
    expect(name!.classList.contains('break-words'), 'al nome del ruolo manca break-words').toBe(true)
    expect(box!.classList.contains('shrink-0'), 'alla casella di spunta manca shrink-0').toBe(true)
  })

  it('keeps the close button at its own width', () => {
    const el = render()
    const close = el.querySelector<HTMLElement>('[aria-label="common.actions.close"]')

    expect(close, 'il bottone di chiusura non e\' stato reso').not.toBe(null)
    expect(close!.classList.contains('shrink-0'), 'al bottone di chiusura manca shrink-0').toBe(true)
  })
})

// I3 della revisione finale: il server rifiuta un ruolo le cui concessioni l'attore non possiede
// tutte (DEC-29). Il dialogo non lo offre: lo mostra disabilitato, con il motivo.
describe('manage roles modal, roles the actor cannot assign', () => {
  const roles = [{ id: 0, name: 'Registered' }, { id: 1, name: 'Administrator' }, { id: 7, name: 'Reader' }]
  const checkbox = (el: HTMLElement, id: number) =>
    el.querySelector<HTMLInputElement>(`[data-testid="role-checkbox-${id}"]`)!

  it('disables a role outside the assignable set and explains why', () => {
    const el = render(roles, [0, 7])
    expect(checkbox(el, 1).disabled).toBe(true)
    expect(checkbox(el, 1).closest('label')?.getAttribute('title')).toBe('users.roles.not_assignable_hint')
    expect(checkbox(el, 7).disabled).toBe(false)
  })

  it('does not offer to remove an assigned role the actor cannot assign', () => {
    const el = render(roles, [0, 7], { ...user, roles: [{ id: 1, name: 'Administrator' }, { id: 7, name: 'Reader' }] })
    expect(el.querySelector('[aria-label="users.roles.remove_label"]')).not.toBe(null)
    expect(el.querySelectorAll('[aria-label="users.roles.remove_label"]')).toHaveLength(1)
  })

  it('locks the base role of the tenant, whatever its id', () => {
    const tenantRoles = [{ id: 31, name: 'Registered' }, { id: 32, name: 'Administrator' }, { id: 7, name: 'Reader' }]
    const el = render(tenantRoles, [31, 7], { ...user, roles: [{ id: 31, name: 'Registered' }] }, 31)
    expect(checkbox(el, 31).disabled).toBe(true)
    expect(el.textContent).toContain('Registered (users.roles.always_assigned)')
    expect(el.querySelectorAll('[aria-label="users.roles.remove_label"]')).toHaveLength(0)
    expect(checkbox(el, 7).disabled).toBe(false)
  })
})
