// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTenantAdmin, addTenantHost, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus,
} from '@/lib/platform/tenant-actions'
import { startSupport } from '@/lib/platform/support-actions'
import type { PlatformTenantDetail } from '@/lib/platform/tenant-service'
import { loadPage } from '@/components/tenancy/load-page'
import { TenantDetail } from './TenantDetail'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => params ? `${key}|${JSON.stringify(params)}` : key,
    fmt: { date: (value: string) => `date:${value}`, dateTime: (value: string) => `dt:${value}` },
  }),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
// Il modulo vero è una server action: arriva al database, che qui non c'è.
vi.mock('@/lib/platform/tenant-actions', () => ({
  addTenantAdmin: vi.fn(), addTenantHost: vi.fn(), removeTenantHost: vi.fn(),
  resendTenantInvite: vi.fn(), setPrimaryHost: vi.fn(), setTenantStatus: vi.fn(),
}))
vi.mock('@/lib/platform/support-actions', () => ({ startSupport: vi.fn() }))
// jsdom non naviga: l'ingresso carica la home del tenant da capo, nel browser.
vi.mock('@/components/tenancy/load-page', () => ({ loadPage: vi.fn() }))

const status = vi.mocked(setTenantStatus)
const addHost = vi.mocked(addTenantHost)
const removeHost = vi.mocked(removeTenantHost)
const makePrimary = vi.mocked(setPrimaryHost)
const addAdmin = vi.mocked(addTenantAdmin)
const resend = vi.mocked(resendTenantInvite)
const enter = vi.mocked(startSupport)
const load = vi.mocked(loadPage)
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
const setAreaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

const ACME: PlatformTenantDetail = {
  id: 7, slug: 'acme', name: 'Acme', status: 'active', isTemplate: false, isDefault: false, createdAt: '2026-07-01T10:00:00Z',
  hosts: [{ host: 'acme.example.test', isPrimary: true }, { host: 'acme2.example.test', isPrimary: false }],
  admins: [{ userId: 'u-1', email: 'capo@acme.test', hasPassword: true }, { userId: 'u-2', email: 'nuovo@acme.test', hasPassword: false }],
  support: { until: null },
}

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => { for (const mock of [status, addHost, removeHost, makePrimary, addAdmin, resend, refresh, enter, load]) mock.mockReset() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function render(tenant: PlatformTenantDetail = ACME) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<TenantDetail tenant={tenant} />))
}

const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
const buttonNamed = (text: string) => buttons().find(button => button.textContent === text)
const need = (text: string) => buttonNamed(text)!
const sectionOf = (heading: string) => Array.from(document.querySelectorAll('section')).find(section => section.querySelector('h2')?.textContent === heading)!
const rowWith = (text: string) => Array.from(document.querySelectorAll('li')).find(row => row.textContent?.includes(text))!
async function click(element: Element) { await act(async () => { (element as HTMLElement).click() }) }
function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const setter = input instanceof HTMLTextAreaElement ? setAreaValue : setNativeValue
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const dialog = () => document.querySelector('[role="dialog"]')!
const alertText = () => document.querySelector('[role="alert"]')?.textContent
const statusText = () => document.querySelector('[role="status"]')?.textContent

describe('TenantDetail: data', () => {
  it('shows the name, the slug, the status and the creation date, with a link back to the list', () => {
    render()
    const data = sectionOf('platform.tenant.detail.data')
    expect(data.textContent).toContain('Acme')
    expect(data.textContent).toContain('acme')
    expect(data.querySelector('[data-testid="tenant-status-badge"]')?.getAttribute('data-status')).toBe('active')
    expect(data.textContent).toContain('date:2026-07-01T10:00:00Z')
    expect(document.querySelector('a[href="/platform"]')?.textContent).toBe('platform.tenant.detail.back')
  })

  it('lists the addresses with the primary one marked, and the administrators with the pending ones marked', () => {
    render()
    expect(rowWith('acme.example.test').textContent).toContain('platform.tenant.host.primary')
    expect(rowWith('acme2.example.test').textContent).not.toContain('platform.tenant.host.primary')
    expect(rowWith('capo@acme.test').textContent).not.toContain('platform.tenant.admin.pending')
    expect(rowWith('nuovo@acme.test').textContent).toContain('platform.tenant.admin.pending')
  })

  it('says so when there are no addresses or no administrators', () => {
    render({ ...ACME, hosts: [], admins: [] })
    expect(document.body.textContent).toContain('platform.tenant.host.empty')
    expect(document.body.textContent).toContain('platform.tenant.admin.empty')
  })
})

describe('TenantDetail: status', () => {
  it.each([
    ['active', ['platform.tenant.status.suspend', 'platform.tenant.status.archive']],
    ['suspended', ['platform.tenant.status.reactivate', 'platform.tenant.status.archive']],
    ['archived', ['platform.tenant.status.restore']],
  ] as const)('a %s tenant offers the buttons that make sense', (current, expected) => {
    render({ ...ACME, status: current })
    const offered = ['suspend', 'reactivate', 'archive', 'restore'].map(name => `platform.tenant.status.${name}`).filter(name => buttonNamed(name))
    expect(offered.sort()).toEqual([...expected].sort())
  })

  it('offers no status button for the default tenant and the template, and says why', () => {
    render({ ...ACME, isDefault: true })
    expect(buttonNamed('platform.tenant.status.suspend')).toBeUndefined()
    expect(document.body.textContent).toContain('platform.tenant.detail.fixed_hint')
  })

  it('suspends only after the confirmation, and refreshes the page', async () => {
    status.mockResolvedValue({ ok: true })
    render()
    await click(need('platform.tenant.status.suspend'))
    expect(status).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('platform.tenant.status.suspend_title')
    expect(dialog().textContent).toContain('"name":"Acme"')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(status).toHaveBeenCalledWith(7, 'suspended')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('cancelling the confirmation changes nothing', async () => {
    render()
    await click(need('platform.tenant.status.suspend'))
    await click(need('common.actions.cancel'))
    expect(status).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('reactivates after the confirmation', async () => {
    status.mockResolvedValue({ ok: true })
    render({ ...ACME, status: 'suspended' })
    await click(need('platform.tenant.status.reactivate'))
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(status).toHaveBeenCalledWith(7, 'active')
  })

  it('archiving asks for a written reason and does not go on without one', async () => {
    status.mockResolvedValue({ ok: true })
    render()
    await click(need('platform.tenant.status.archive'))
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(status).not.toHaveBeenCalled()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.status.reason_required')

    type(dialog().querySelector('textarea')!, '  Contratto concluso ')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(status).toHaveBeenCalledWith(7, 'archived', 'Contratto concluso')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('suspending and reactivating have no reason field', async () => {
    render()
    await click(need('platform.tenant.status.suspend'))
    expect(dialog().querySelector('textarea')).toBe(null)
  })

  it('restoring from the archive passes the explicit confirmation to the server', async () => {
    status.mockResolvedValue({ ok: true })
    render({ ...ACME, status: 'archived' })
    await click(need('platform.tenant.status.restore'))
    expect(status).not.toHaveBeenCalled()
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(status).toHaveBeenCalledWith(7, 'active', undefined, true)
  })

  it('shows the generic error, never the message of the server, and does not refresh', async () => {
    status.mockRejectedValue(new Error('un dettaglio del server'))
    render()
    await click(need('platform.tenant.status.suspend'))
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(alertText()).toBe('platform.tenant.status.error')
    expect(document.body.textContent).not.toContain('un dettaglio del server')
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('TenantDetail: addresses', () => {
  it('adds an address, optionally primary, and refreshes', async () => {
    addHost.mockResolvedValue({ ok: true })
    render()
    await click(need('platform.tenant.host.add'))
    type(dialog().querySelector('input[type="text"], input:not([type])')!, 'nuovo.example.test')
    await click(dialog().querySelector('input[type="checkbox"]')!)
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(addHost).toHaveBeenCalledWith(7, 'nuovo.example.test', true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['taken', 'platform.tenant.host.error_taken'],
    ['invalid', 'platform.tenant.host.error_invalid'],
  ] as const)('says why an address was refused (%s)', async (reason, key) => {
    addHost.mockResolvedValue({ ok: false, reason })
    render()
    await click(need('platform.tenant.host.add'))
    type(dialog().querySelector('input:not([type])')!, 'x.example.test')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(key)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('makes an address primary only after the confirmation', async () => {
    makePrimary.mockResolvedValue({ ok: true })
    render()
    await click(need('platform.tenant.host.make_primary'))
    expect(makePrimary).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('"host":"acme2.example.test"')
    await click(need('common.actions.confirm'))
    expect(makePrimary).toHaveBeenCalledWith(7, 'acme2.example.test')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers "make primary" only on the addresses that are not primary', () => {
    render()
    expect(rowWith('acme.example.test').textContent).not.toContain('platform.tenant.host.make_primary')
    expect(rowWith('acme2.example.test').textContent).toContain('platform.tenant.host.make_primary')
  })

  it('removes an address only after the confirmation, and explains a refusal for the primary one', async () => {
    removeHost.mockResolvedValue({ ok: false, reason: 'primary' })
    render()
    await click(Array.from(rowWith('acme.example.test').querySelectorAll('button')).find(b => b.textContent === 'platform.tenant.host.remove')!)
    expect(removeHost).not.toHaveBeenCalled()
    await click(need('common.actions.confirm'))
    expect(removeHost).toHaveBeenCalledWith(7, 'acme.example.test')
    expect(alertText()).toBe('platform.tenant.host.error_primary')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shows the generic error when an address action throws', async () => {
    removeHost.mockRejectedValue(new Error('un dettaglio'))
    render()
    await click(Array.from(rowWith('acme2.example.test').querySelectorAll('button')).find(b => b.textContent === 'platform.tenant.host.remove')!)
    await click(need('common.actions.confirm'))
    expect(alertText()).toBe('platform.tenant.host.error')
  })
})

describe('TenantDetail: administrators', () => {
  it('adds an administrator by email and says an email is on its way', async () => {
    addAdmin.mockResolvedValue({ ok: true, invited: true })
    render()
    await click(need('platform.tenant.admin.add'))
    type(dialog().querySelector('input')!, 'nuova@acme.test')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(addAdmin).toHaveBeenCalledWith(7, 'nuova@acme.test')
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe('platform.tenant.admin.done_invited')
    expect(dialog().querySelector('input')!.value).toBe('')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says plainly when the invitation email was not sent', async () => {
    addAdmin.mockResolvedValue({ ok: true, invited: false, inviteFailed: true })
    render()
    await click(need('platform.tenant.admin.add'))
    type(dialog().querySelector('input')!, 'nuova@acme.test')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.admin.done_invite_failed')
  })

  it('says done, with no email, for an account that can already sign in', async () => {
    addAdmin.mockResolvedValue({ ok: true, invited: false })
    render()
    await click(need('platform.tenant.admin.add'))
    type(dialog().querySelector('input')!, 'nuova@acme.test')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe('platform.tenant.admin.done')
  })

  it('does not call the action for an email that is not one', async () => {
    render()
    await click(need('platform.tenant.admin.add'))
    type(dialog().querySelector('input')!, 'non-una-email')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(addAdmin).not.toHaveBeenCalled()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('platform.admins.add.invalid_email')
  })

  it('shows the generic error when adding fails', async () => {
    addAdmin.mockRejectedValue(new Error('un dettaglio'))
    render()
    await click(need('platform.tenant.admin.add'))
    type(dialog().querySelector('input')!, 'nuova@acme.test')
    await click(dialog().querySelector('button[type="submit"]')!)
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('platform.tenant.admin.error')
  })

  it('offers "resend invitation" only to administrators who have no password yet, and says so after sending', async () => {
    resend.mockResolvedValue({ ok: true, invited: true })
    render()
    expect(rowWith('capo@acme.test').textContent).not.toContain('platform.tenant.admin.resend')
    await click(Array.from(rowWith('nuovo@acme.test').querySelectorAll('button')).find(b => b.textContent === 'platform.tenant.admin.resend')!)
    expect(resend).toHaveBeenCalledWith(7, 'u-2')
    expect(statusText()).toBe('platform.tenant.admin.resent')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says when the resent email did not go out, and when the call failed', async () => {
    resend.mockResolvedValueOnce({ ok: true, invited: false, inviteFailed: true })
    render()
    const button = () => Array.from(rowWith('nuovo@acme.test').querySelectorAll('button')).find(b => b.textContent === 'platform.tenant.admin.resend')!
    await click(button())
    expect(alertText()).toBe('platform.tenant.admin.done_invite_failed')
    resend.mockRejectedValueOnce(new Error('un dettaglio'))
    await click(button())
    expect(alertText()).toBe('platform.tenant.admin.error')
  })

  it.each(['suspended', 'archived'] as const)('in a %s tenant the add and resend buttons are off and the reason is written in the page', status => {
    render({ ...ACME, status })
    expect(need('platform.tenant.admin.add').disabled).toBe(true)
    const resendButton = Array.from(rowWith('nuovo@acme.test').querySelectorAll('button')).find(b => b.textContent === 'platform.tenant.admin.resend')!
    expect(resendButton.disabled).toBe(true)
    expect(document.body.textContent).toContain('platform.tenant.detail.inactive_hint')
    expect(document.getElementById(need('platform.tenant.admin.add').getAttribute('aria-describedby')!)?.textContent).toBe('platform.tenant.detail.inactive_hint')
  })
})

describe('TenantDetail: the template', () => {
  it('has no addresses and no administrators to manage, and says so', () => {
    render({ ...ACME, isTemplate: true, hosts: [], admins: [] })
    expect(document.body.textContent).toContain('platform.tenant.detail.template_hint')
    expect(buttonNamed('platform.tenant.host.add')).toBeUndefined()
    expect(buttonNamed('platform.tenant.admin.add')).toBeUndefined()
    expect(buttonNamed('platform.tenant.status.suspend')).toBeUndefined()
  })
})

// Pezzo 5a, Task 9 (MT5-DEC-6, MT5-DEC-10, MT5-DEC-11): lo stato del permesso e l'ingresso di assistenza.
describe('TenantDetail: support', () => {
  const CONSENT = { ...ACME, support: { until: '2026-10-28T10:00:00.000Z' } }
  const supportSection = () => sectionOf('platform.tenant.detail.support')

  it('without consent says so, and the enter button is off with the reason written in the page', () => {
    render()
    expect(supportSection().textContent).toContain('platform.support.none')
    const button = need('platform.support.enter')
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('platform.support.disabled_hint')
  })

  it('with consent shows the expiry and enters with a written reason, then loads the tenant home', async () => {
    enter.mockResolvedValue({ state: 'support' })
    render(CONSENT)
    expect(supportSection().textContent).toContain('platform.support.until|{"time":"dt:2026-10-28T10:00:00.000Z"}')
    await click(need('platform.support.enter'))
    expect(dialog().textContent).toContain('platform.support.enter_title')

    // Senza motivo non parte (MT5-DEC-9).
    await click(need('platform.support.enter_submit'))
    expect(alertText()).toBe('platform.tenant.status.reason_required')
    expect(enter).not.toHaveBeenCalled()

    type(dialog().querySelector('textarea')!, '  controllo del menu  ')
    await click(need('platform.support.enter_submit'))
    expect(enter).toHaveBeenCalledWith(7, 'controllo del menu')
    expect(load).toHaveBeenCalledWith('/')
  })

  it('a refused entry shows the generic error and stays on the page', async () => {
    enter.mockRejectedValue(new Error('un dettaglio'))
    render(CONSENT)
    await click(need('platform.support.enter'))
    type(dialog().querySelector('textarea')!, 'motivo')
    await click(need('platform.support.enter_submit'))
    expect(alertText()).toBe('platform.support.enter_error')
    expect(load).not.toHaveBeenCalled()
  })

  // Fix round 1: il permesso revocato fra il clic e l'aggiornamento della sessione. L'azione è riuscita a
  // metà (la sessione non è in assistenza): niente home del tenant, l'errore generico.
  it('an entry that did not reach the support state shows the error and stays on the page', async () => {
    enter.mockResolvedValue({ state: 'none' })
    render(CONSENT)
    await click(need('platform.support.enter'))
    type(dialog().querySelector('textarea')!, 'motivo')
    await click(need('platform.support.enter_submit'))
    expect(alertText()).toBe('platform.support.enter_error')
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['suspended', 'archived'] as const)('in a %s tenant the consent does not open the door', status => {
    render({ ...CONSENT, status })
    expect(need('platform.support.enter').disabled).toBe(true)
  })

  it('the template is always enterable, without consent', () => {
    render({ ...ACME, isTemplate: true, hosts: [], admins: [] })
    expect(supportSection().textContent).toContain('platform.support.template')
    expect(need('platform.support.enter').disabled).toBe(false)
  })
})
