// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlatformAdmin, removePlatformAdmin } from '@/lib/platform/platform-admin-actions'
import type { PlatformAdminRow } from '@/lib/platform/platform-admin-service'
import { PlatformAdmins } from './PlatformAdmins'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key}|${JSON.stringify(params)}` : key }),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
// Il modulo vero è una server action: arriva al database, che qui non c'è.
vi.mock('@/lib/platform/platform-admin-actions', () => ({ addPlatformAdmin: vi.fn(), removePlatformAdmin: vi.fn() }))

const add = vi.mocked(addPlatformAdmin)
const remove = vi.mocked(removePlatformAdmin)
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

const ME: PlatformAdminRow = { id: 'u-me', email: 'me@example.test', name: 'Io Stesso', active: true }
const OTHER: PlatformAdminRow = { id: 'u-other', email: 'other@example.test', name: null, active: true }
const DEACTIVATED: PlatformAdminRow = { id: 'u-off', email: 'off@example.test', name: null, active: false }

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => { add.mockReset(); remove.mockReset(); refresh.mockReset() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function render(admins: PlatformAdminRow[]) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<PlatformAdmins admins={admins} currentUserId="u-me" />))
}

const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
const buttonNamed = (text: string) => buttons().find(button => button.textContent === text)!
const rowOf = (email: string) => Array.from(document.querySelectorAll('tbody tr')).find(row => row.textContent?.includes(email))!
const emailField = () => document.querySelector<HTMLInputElement>('input[type="email"]')!

async function click(element: Element) { await act(async () => { (element as HTMLElement).click() }) }
function type(input: HTMLInputElement, text: string) {
  act(() => { setNativeValue.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('PlatformAdmins', () => {
  it('lists the administrators with their email, name and status, and marks the signed-in one', () => {
    render([ME, OTHER, DEACTIVATED])
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(rowOf('me@example.test').textContent).toContain('Io Stesso')
    expect(rowOf('me@example.test').textContent).toContain('platform.admins.you')
    expect(rowOf('other@example.test').textContent).not.toContain('platform.admins.you')
    expect(rowOf('off@example.test').textContent).toContain('users.status.deactivated')
    expect(rowOf('other@example.test').textContent).toContain('users.status.active')
  })

  it('adds an administrator: valid email goes to the action and the page refreshes', async () => {
    add.mockResolvedValue({ ok: true, invited: false })
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'Nuovo@Esempio.it')
    await click(buttonNamed('platform.admins.add.submit'))
    expect(add).toHaveBeenCalledWith('Nuovo@Esempio.it')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('platform.admins.add.done')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says the person will receive an email when the account is new', async () => {
    add.mockResolvedValue({ ok: true, invited: true })
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'nuovo@esempio.it')
    await click(buttonNamed('platform.admins.add.submit'))
    expect(document.querySelector('[role="status"]')?.textContent).toBe('platform.admins.add.done_invited')
  })

  it('tells the operator the invitation was not sent, and how to recover, when the email failed', async () => {
    add.mockResolvedValue({ ok: true, invited: false, inviteFailed: true })
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'nuovo@esempio.it')
    await click(buttonNamed('platform.admins.add.submit'))
    // Un messaggio a parte, che si legge come un avviso e non come «Amministratore aggiunto».
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.admins.add.done_invite_failed')
    expect(document.querySelector('[role="status"]')).toBe(null)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('clears the email after a successful add, so the dialog cannot add the same person twice by mistake', async () => {
    add.mockResolvedValue({ ok: true, invited: true })
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'nuovo@esempio.it')
    await click(buttonNamed('platform.admins.add.submit'))
    expect(emailField().value).toBe('')
    expect(buttonNamed('platform.admins.add.submit').disabled).toBe(true)
    // L'esito resta leggibile finché non si scrive di nuovo.
    expect(document.querySelector('[role="status"]')?.textContent).toBe('platform.admins.add.done_invited')
    type(emailField(), 'altro@esempio.it')
    expect(document.querySelector('[role="status"]')).toBe(null)
  })

  it('does not call the action for an email that is not one', async () => {
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'non-una-email')
    await click(buttonNamed('platform.admins.add.submit'))
    expect(add).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.admins.add.invalid_email')
  })

  it('shows the generic error, never the message of the server', async () => {
    add.mockRejectedValue(new Error('un dettaglio del server'))
    render([ME])
    await click(buttonNamed('platform.admins.add.open'))
    type(emailField(), 'nuovo@esempio.it')
    await click(buttonNamed('platform.admins.add.submit'))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.admins.add.error')
    expect(document.body.textContent).not.toContain('un dettaglio del server')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('asks for confirmation before removing, then removes and refreshes', async () => {
    remove.mockResolvedValue({ ok: true })
    render([ME, OTHER])
    await click(rowOf('other@example.test').querySelector('button')!)
    expect(remove).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('other@example.test')
    await click(buttonNamed('platform.admins.remove.confirm'))
    expect(remove).toHaveBeenCalledWith('u-other')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('cancelling the confirmation removes nothing', async () => {
    render([ME, OTHER])
    await click(rowOf('other@example.test').querySelector('button')!)
    await click(buttonNamed('common.actions.cancel'))
    expect(remove).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('shows the generic error when the removal is refused', async () => {
    remove.mockRejectedValue(new Error('Non si toglie l\'ultimo'))
    render([ME, OTHER])
    await click(rowOf('other@example.test').querySelector('button')!)
    await click(buttonNamed('platform.admins.remove.confirm'))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.admins.remove.error')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('disables removing the last active administrator and says why, in visible text the button points to', () => {
    render([ME, DEACTIVATED])
    const button = rowOf('me@example.test').querySelector('button')!
    expect(button.disabled).toBe(true)
    // Il motivo è testo nella pagina (non un `title`, che su un bottone spento non si vede da tastiera né da touch).
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('platform.admins.remove.last_hint')
    expect(rowOf('me@example.test').textContent).toContain('platform.admins.remove.last_hint')
    expect(button.title).toBe('')
  })

  it('shows no hint on a button that can be used', () => {
    render([ME, OTHER])
    const button = rowOf('other@example.test').querySelector('button')!
    expect(button.getAttribute('aria-describedby')).toBe(null)
    expect(rowOf('other@example.test').textContent).not.toContain('last_hint')
  })

  it('allows removing anyone while two administrators are active', () => {
    render([ME, OTHER])
    expect(rowOf('me@example.test').querySelector('button')!.disabled).toBe(false)
    expect(rowOf('other@example.test').querySelector('button')!.disabled).toBe(false)
  })
})
