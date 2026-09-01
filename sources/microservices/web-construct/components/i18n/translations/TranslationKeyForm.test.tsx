// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import { createTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { TranslationKeyForm } from './TranslationKeyForm'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `vi.hoisted`, not a plain `const`: vi.mock factories are hoisted above the
// module's top-level statements, so a bare const would still be in its
// temporal dead zone when the factory runs.
const pushed = vi.hoisted(() => ({ hrefs: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushed.hrefs.push(href) } }),
}))

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    languages: [
      { id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano', isActive: true, isDefault: true },
      { id: 2, code: 'en', locale: 'en-GB', name: 'English', nativeName: 'English', isActive: true, isDefault: false },
    ],
  }),
}))

vi.mock('@/lib/i18n/translation-actions', () => ({
  createTranslationKey: vi.fn(),
  saveTranslations: vi.fn(),
}))

const row = {
  id: 7, key: 'auth.login.title', namespace: 'auth', module: 'core',
  description: 'Login card title', version: 3, updatedAt: null,
  values: { it: { id: 11, value: 'Accedi', version: 2 } },
  missingCodes: ['en'],
} as unknown as TranslationRowDto

// A stored module of `null` starts the field empty, so focusing it lists every
// option unfiltered. With `namespaces` and `modules` holding disjoint values, a
// swap of the two props would show ['auth','nav'] here and fail loudly.
const rowWithNoModule = { ...row, id: 8, namespace: 'nav', module: null } as unknown as TranslationRowDto

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(node))
}

function field<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`missing element: ${selector}`)
  return found
}

// A plain `element.value = value` doesn't reach React's onChange for an
// `<input>`: React tracks the node's own `value` property to tell a real
// keystroke from a script poking the DOM directly, and an assignment through
// that same tracked property leaves nothing for the tracker to notice. Going
// through the *prototype*'s setter bypasses the tracked one, which is what
// makes the following `dispatchEvent` register as a change. Textareas are
// tracked the same way, so the same route is used for both — matching the
// idiom already in components/shared/EditableCombobox.test.tsx.
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)
  if (!found) throw new Error(`missing button: ${label}`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  pushed.hrefs.length = 0
  vi.mocked(createTranslationKey).mockReset()
  vi.mocked(saveTranslations).mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('TranslationKeyForm in edit mode', () => {
  it('shows the stored metadata and one value box per language', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth', 'nav']} modules={['core']} from="" />)

    expect(field<HTMLInputElement>('#tk-ns').value).toBe('auth')
    expect(field<HTMLInputElement>('#tk-mod').value).toBe('core')
    expect(field<HTMLTextAreaElement>('#tk-desc').value).toBe('Login card title')
    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]').value).toBe('Accedi')
    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]').value).toBe('')
  })

  it('does not let the key be renamed, because the save path cannot rename it', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(document.querySelector('#tk-key')).toBeNull()
    expect(container?.textContent).toContain('auth.login.title')
  })

  it('offers the existing namespaces without discarding the stored value', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth', 'nav']} modules={['core']} from="" />)
    const ns = field<HTMLInputElement>('#tk-ns')
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    // 'auth' is already in the field, so the list is filtered down to it.
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['auth'])
  })

  it('offers the existing modules, not the namespaces, in the module field', () => {
    render(
      <TranslationKeyForm
        mode="edit" row={rowWithNoModule}
        namespaces={['auth', 'nav']} modules={['billing', 'docs']} from=""
      />,
    )
    const mod = field<HTMLInputElement>('#tk-mod')
    expect(mod.value).toBe('')
    act(() => mod.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['billing', 'docs'])
  })

  it('keeps Salva disabled until something actually changes', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(button('common.actions.save').disabled).toBe(true)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]'), 'Sign in')
    expect(button('common.actions.save').disabled).toBe(false)
  })

  it('puts the server values back when Ripristina is pressed', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(button('translation.actions.discard').disabled).toBe(true)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Entra')
    type(field<HTMLTextAreaElement>('#tk-desc'), 'Something else')
    expect(button('translation.actions.discard').disabled).toBe(false)

    act(() => button('translation.actions.discard').click())

    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]').value).toBe('Accedi')
    expect(field<HTMLTextAreaElement>('#tk-desc').value).toBe('Login card title')
    expect(button('translation.actions.discard').disabled).toBe(true)
    expect(button('common.actions.save').disabled).toBe(true)
  })

  it('sends every language with the version it loaded, and returns to the filtered list', async () => {
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    render(
      <TranslationKeyForm
        mode="edit" row={row} namespaces={['auth']} modules={['core']}
        from="sort=namespace&direction=ASC"
      />,
    )

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]'), 'Sign in')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(saveTranslations).mock.calls[0][0]).toEqual({
      keyId: 7, keyVersion: 3, description: 'Login card title',
      namespace: 'auth', module: 'core',
      values: [
        { languageCode: 'it', value: 'Accedi', version: 2 },
        // No row for English yet, so the save path is told to insert.
        { languageCode: 'en', value: 'Sign in', version: null },
      ],
    })
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=namespace&direction=ASC'])
  })

  it('shows the conflict panel instead of navigating away when the save is refused', async () => {
    vi.mocked(saveTranslations).mockResolvedValue({
      ok: false,
      conflicts: [{ languageCode: 'it', currentValue: 'Vinta', attemptedValue: 'Persa' }],
    })
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Persa')
    await act(async () => { button('common.actions.save').click() })

    const panel = field('[data-testid="translation-conflict"]')
    expect(panel.textContent).toContain('Vinta')
    expect(pushed.hrefs).toEqual([])
  })

  it('returns to the filtered list on Annulla without saving', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="sort=key" />)
    act(() => button('common.actions.cancel').click())

    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=key'])
  })

  it('surfaces a rejected save instead of quietly re-enabling Salva with nothing to show for it', async () => {
    // `requireAdmin()` (lib/rbac/auth-guard.ts) throws rather than returning
    // an error — this simulates an expired session or a downgraded admin,
    // which a bare try/finally with no catch used to swallow silently.
    vi.mocked(saveTranslations).mockRejectedValue(new Error('Sessione scaduta.'))
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]'), 'Sign in')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sessione scaduta.')
    expect(pushed.hrefs).toEqual([])
    // Saving stopped rather than staying stuck forever, so the admin can try again.
    expect(button('common.actions.save').textContent).toBe('common.actions.save')
  })
})

describe('TranslationKeyForm in create mode', () => {
  it('lets the namespace follow the key by convention until it is overridden', () => {
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    expect(field<HTMLInputElement>('#tk-ns').value).toBe('billing')

    type(field<HTMLInputElement>('#tk-ns'), 'accounting')
    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.subtitle')
    expect(field<HTMLInputElement>('#tk-ns').value).toBe('accounting')
  })

  it('gates Salva on a well-formed key and namespace, not on dirtiness', () => {
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)
    expect(button('common.actions.save').disabled).toBe(true)

    // Rejected by the same rules as validateKeyInput: a key needs a dot.
    type(field<HTMLInputElement>('#tk-key'), 'billing')
    expect(button('common.actions.save').disabled).toBe(true)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    expect(button('common.actions.save').disabled).toBe(false)
  })

  it('creates the key and then saves the values that were typed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="sort=key" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey).mock.calls[0][0]).toEqual({
      key: 'billing.invoice.title', namespace: 'billing', module: null, description: null,
    })
    expect(vi.mocked(saveTranslations).mock.calls[0][0]).toEqual({
      keyId: 99, keyVersion: 1, description: null, namespace: 'billing', module: null,
      values: [
        { languageCode: 'it', value: 'Fattura', version: null },
        { languageCode: 'en', value: '', version: null },
      ],
    })
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=key'])
  })

  it('skips the second call when no value was typed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual(['/admin/translations'])
  })

  it('does not create the key twice when only the values failed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('boom')
    expect(pushed.hrefs).toEqual([])
    // The key now exists. A retry must save values only, or it would collide
    // with the unique constraint on `key` and report a misleading error.
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveTranslations)).toHaveBeenCalledTimes(2)
    expect(pushed.hrefs).toEqual(['/admin/translations'])
  })

  it('reaches saveValues on a retry after clearing the value and fixing the description instead, rather than navigating away with that edit silently dropped', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValueOnce({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(saveTranslations)).toHaveBeenCalledTimes(1)

    // The key now exists (`createdId` is set from the call above). Clearing
    // the value back to blank and fixing the description instead must still
    // reach `saveValues` — the "nothing typed" shortcut is only correct
    // before the key exists, when `createTranslationKey` alone has already
    // persisted the metadata. On this retry it hasn't: `saveTranslations` is
    // what would persist the new description, and it failed last time.
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), '')
    type(field<HTMLTextAreaElement>('#tk-desc'), 'Fattura elettronica')

    vi.mocked(saveTranslations).mockResolvedValueOnce({ ok: true })
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveTranslations)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveTranslations).mock.calls[1][0]).toMatchObject({
      keyId: 99, description: 'Fattura elettronica',
    })
    expect(pushed.hrefs).toEqual(['/admin/translations'])
  })

  it('locks the key once it has been created, so a retry cannot rename it out from under the row', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    // Nothing in SaveTranslationsInput carries a key, so once created there is
    // no rename path — editing it further here would only diverge what's
    // shown from what a retry actually persists under the id it already has.
    expect(field<HTMLInputElement>('#tk-key').disabled).toBe(true)

    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveTranslations).mock.calls[1][0]).toMatchObject({ keyId: 99, keyVersion: 1 })
  })

  it('does not let Ripristina blank the namespace of a key that has already been created', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(field<HTMLInputElement>('#tk-ns').value).toBe('billing')

    act(() => button('translation.actions.discard').click())

    // Not '': create mode has no `row` to fall back on, but the key was
    // already created with namespace 'billing' — reverting to blank would
    // silently rewrite it to something that no longer matches the key.
    expect(field<HTMLInputElement>('#tk-ns').value).toBe('billing')
  })

  it('keeps Salva enabled in create mode even once nothing is left to be dirty', async () => {
    // Would fail if create mode were gated on dirtiness the way edit mode is:
    // after Ripristina below, the form is back to exactly what was created —
    // dirty is false — and Salva still has to be able to retry the save.
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    act(() => button('translation.actions.discard').click())

    expect(button('translation.actions.discard').disabled).toBe(true)
    expect(button('common.actions.save').disabled).toBe(false)
  })

  it('reports a refused create and calls nothing else', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: 'Esiste già una chiave con questo nome.' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Esiste già')
    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual([])
  })

  it('surfaces a rejected create instead of quietly re-enabling Salva with nothing to show for it', async () => {
    vi.mocked(createTranslationKey).mockRejectedValue(new Error('Sessione scaduta.'))
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sessione scaduta.')
    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual([])
    expect(button('common.actions.save').textContent).toBe('common.actions.save')
  })
})
