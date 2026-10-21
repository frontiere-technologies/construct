// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addUserByEmail } from '@/lib/rbac/users-actions'
import { AddUserDialog } from './AddUserDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
// Il modulo vero e' una server action: arriva al database, che qui non c'e'.
vi.mock('@/lib/rbac/users-actions', () => ({ addUserByEmail: vi.fn() }))

const addUser = vi.mocked(addUserByEmail)
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

let root: Root | undefined
let container: HTMLDivElement | undefined

// Con le graffe: un valore ritornato da beforeEach, se e' una funzione, vitest lo esegue come pulizia.
beforeEach(() => { addUser.mockReset() })

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
  const onClose = vi.fn()
  const onAdded = vi.fn()
  act(() => root?.render(<AddUserDialog open onClose={onClose} onAdded={onAdded} />))
  return { onClose, onAdded }
}

const emailField = () => document.querySelector<HTMLInputElement>('input[type="email"]')!
const submitButton = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'users.add.submit')!

function type(input: HTMLInputElement, text: string) {
  act(() => {
    setNativeValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => { submitButton().click() })
}

describe('add user dialog', () => {
  it('renders nothing while closed', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<AddUserDialog open={false} onClose={() => {}} onAdded={() => {}} />))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('labels the email field and the dialog', () => {
    render()
    expect(document.querySelector('h2')?.textContent).toBe('users.add.title')
    expect(emailField().labels?.[0]?.textContent).toBe('users.add.email_label')
  })

  it('submits the email and shows the neutral confirmation', async () => {
    addUser.mockResolvedValue({ ok: true })
    const { onAdded } = render()
    type(emailField(), 'Persona@Esempio.it')
    await submit()

    expect(addUser).toHaveBeenCalledTimes(1)
    expect(addUser).toHaveBeenCalledWith('Persona@Esempio.it')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('users.add.done')
    expect(document.querySelector('[role="alert"]')).toBe(null)
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('shows the invalid-email message without calling the action', async () => {
    const { onAdded } = render()
    type(emailField(), 'non-una-email')
    await submit()

    expect(addUser).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('users.add.invalid_email')
    expect(document.querySelector('[role="status"]')).toBe(null)
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('shows the generic error in role="alert" when the action fails', async () => {
    addUser.mockRejectedValue(new Error('qualunque dettaglio del server'))
    const { onAdded } = render()
    type(emailField(), 'persona@esempio.it')
    await submit()

    expect(document.querySelector('[role="alert"]')?.textContent).toBe('users.add.error')
    expect(document.querySelector('[role="status"]')).toBe(null)
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('forgets the previous outcome when the person types again', async () => {
    addUser.mockResolvedValue({ ok: true })
    render()
    type(emailField(), 'persona@esempio.it')
    await submit()
    expect(document.querySelector('[role="status"]')).not.toBe(null)

    type(emailField(), 'altra@esempio.it')
    expect(document.querySelector('[role="status"]')).toBe(null)
  })
})
