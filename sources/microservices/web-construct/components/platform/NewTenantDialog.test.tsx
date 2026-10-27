// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTenant } from '@/lib/platform/tenant-actions'
import { NewTenantDialog } from './NewTenantDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
// Il modulo vero è una server action: arriva al database, che qui non c'è.
vi.mock('@/lib/platform/tenant-actions', () => ({ createTenant: vi.fn() }))

const create = vi.mocked(createTenant)
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
const onClose = vi.fn()
const onCreated = vi.fn()

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => { create.mockReset(); onClose.mockReset(); onCreated.mockReset() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<NewTenantDialog onClose={onClose} onCreated={onCreated} />))
}

const field = (label: string) => {
  const labelEl = Array.from(document.querySelectorAll('label')).find(el => el.textContent === label)!
  return document.getElementById(labelEl.htmlFor) as HTMLInputElement
}
function type(input: HTMLInputElement, text: string) {
  act(() => { setNativeValue.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const buttonNamed = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text)!
async function submit() { await act(async () => { buttonNamed('platform.tenant.new.submit').click() }) }
function fillValid(host = '') {
  type(field('platform.tenant.new.name'), 'Acme Costruzioni')
  if (host) type(field('platform.tenant.new.host'), host)
  type(field('platform.tenant.new.admin_email'), 'capo@acme.test')
}

describe('NewTenantDialog', () => {
  it('has the four fields of MT5-DEC-5 and proposes the slug from the name', () => {
    render()
    for (const label of ['name', 'slug', 'host', 'admin_email']) expect(field(`platform.tenant.new.${label}`)).toBeTruthy()
    type(field('platform.tenant.new.name'), 'Società Più')
    expect(field('platform.tenant.new.slug').value).toBe('societa-piu')
  })

  it('stops proposing the slug once the person has written one', () => {
    render()
    type(field('platform.tenant.new.name'), 'Acme')
    type(field('platform.tenant.new.slug'), 'mio-slug')
    type(field('platform.tenant.new.name'), 'Acme Costruzioni')
    expect(field('platform.tenant.new.slug').value).toBe('mio-slug')
  })

  it('creates the tenant with the fields as written, no host when the field is empty, and refreshes the list', async () => {
    create.mockResolvedValue({ ok: true, tenantId: 9, invited: true })
    render()
    fillValid()
    await submit()
    expect(create).toHaveBeenCalledWith({ name: 'Acme Costruzioni', slug: 'acme-costruzioni', adminEmail: 'capo@acme.test' })
    expect(document.querySelector('[role="status"]')?.textContent).toBe('platform.tenant.new.done_invited')
    expect(onCreated).toHaveBeenCalledWith(9)
  })

  it('sends the dedicated address when there is one', async () => {
    create.mockResolvedValue({ ok: true, tenantId: 9, invited: true })
    render()
    fillValid('acme.example.test')
    await submit()
    expect(create).toHaveBeenCalledWith({ name: 'Acme Costruzioni', slug: 'acme-costruzioni', host: 'acme.example.test', adminEmail: 'capo@acme.test' })
  })

  it('tells that an account with a password can sign in right away: no email', async () => {
    create.mockResolvedValue({ ok: true, tenantId: 9, invited: false })
    render()
    fillValid()
    await submit()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('platform.tenant.new.done_existing')
  })

  it('tells that the invitation email was not sent when the tenant exists but the email failed', async () => {
    create.mockResolvedValue({ ok: true, tenantId: 9, invited: false, inviteFailed: true })
    render()
    fillValid()
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.new.done_invite_failed')
    expect(document.querySelector('[role="status"]')).toBe(null)
    expect(onCreated).toHaveBeenCalledWith(9)
  })

  it('after a creation the form is gone, so the tenant cannot be created twice', async () => {
    create.mockResolvedValue({ ok: true, tenantId: 9, invited: true })
    render()
    fillValid()
    await submit()
    expect(document.querySelector('form')).toBe(null)
    await act(async () => { buttonNamed('common.actions.close').click() })
    expect(onClose).toHaveBeenCalled()
  })

  it('says the slug or the address is already used, and keeps the form for another try', async () => {
    create.mockResolvedValue({ ok: false, reason: 'taken' })
    render()
    fillValid('acme.example.test')
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.new.error_taken')
    expect(field('platform.tenant.new.name').value).toBe('Acme Costruzioni')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('says the address is not valid when the server refuses it as a host name', async () => {
    create.mockResolvedValue({ ok: false, reason: 'invalid' })
    render()
    fillValid('not a host')
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.new.host_invalid')
  })

  it('shows the generic error, never the message of the server', async () => {
    create.mockRejectedValue(new Error('un dettaglio del server'))
    render()
    fillValid()
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.new.error')
    expect(document.body.textContent).not.toContain('un dettaglio del server')
  })

  it.each([
    ['no name', () => { type(field('platform.tenant.new.admin_email'), 'capo@acme.test'); type(field('platform.tenant.new.slug'), 'acme') }],
    ['a slug that is too short', () => { fillValid(); type(field('platform.tenant.new.slug'), 'ab') }],
    ['an email that is not one', () => { fillValid(); type(field('platform.tenant.new.admin_email'), 'non-una-email') }],
  ])('does not call the action with %s', async (_label, arrange) => {
    render()
    arrange()
    await submit()
    expect(create).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.new.invalid')
  })
})
