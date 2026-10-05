// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguagePageItemDto } from '@/lib/i18n/types'
import LanguageFormModal from './LanguageFormModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'it-IT' }),
}))

vi.mock('@/lib/i18n/language-actions', () => ({
  createLanguage: vi.fn(async () => ({ error: null })),
  updateLanguage: vi.fn(async () => ({ error: null })),
}))

const EXISTING: LanguagePageItemDto = {
  id: 7, code: 'fr', locale: 'fr-FR', name: 'Francese', nativeName: 'Français',
  isActive: true, isDefault: false, translated: 0, missing: 0, createdAt: null, updatedAt: null,
}

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(language: LanguagePageItemDto | null, existingCodes: string[] = ['it', 'en']) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const onClose = vi.fn()
  act(() => root?.render(<LanguageFormModal language={language} existingCodes={existingCodes} onClose={onClose} />))
  return { onClose }
}

const picker = () => document.querySelector<HTMLInputElement>('[role="combobox"]')
const field = (id: string) => document.getElementById(id) as HTMLInputElement
const fields = () => ['lang-code', 'lang-locale', 'lang-name', 'lang-native'].map(id => field(id).value)
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
const option = (text: string) => options().find(o => o.textContent?.includes(text))!

const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function type(input: HTMLInputElement, text: string) {
  act(() => {
    setNativeValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(input: HTMLInputElement, key: string) {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
}

function choose(element: HTMLElement) {
  act(() => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('LanguageFormModal language picker', () => {
  it('is offered when creating, labelled and focused first', () => {
    render(null)
    const input = picker()!
    expect(input).not.toBeNull()
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('language.form.preset')
    expect(document.activeElement).toBe(input)
  })

  it('is not offered when editing an existing language', () => {
    render(EXISTING)
    expect(picker()).toBeNull()
    expect(fields()).toEqual(['fr', 'fr-FR', 'Francese', 'Français'])
  })

  it('fills code, locale, name and native name from the chosen language', () => {
    render(null)
    const input = picker()!
    type(input, 'tede')
    choose(option('Tedesco'))
    expect(fields()).toEqual(['de', 'de-DE', 'Tedesco', 'Deutsch'])
    expect(input.value).toBe('Tedesco')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('leaves the filled fields editable', () => {
    render(null)
    type(picker()!, 'portog')
    choose(option('Portoghese'))
    type(field('lang-locale'), 'pt-BR')
    expect(fields()).toEqual(['pt', 'pt-BR', 'Portoghese', 'Português'])
  })

  it('chooses the first match with Enter, and the next one with the arrow keys', () => {
    render(null)
    const input = picker()!
    type(input, 'olan')
    press(input, 'Enter')
    expect(fields()).toEqual(['nl', 'nl-NL', 'Olandese', 'Nederlands'])

    type(input, 'svedese')
    press(input, 'ArrowDown')
    // "Svedese" then "Altra lingua…": the arrow moved off the first match.
    expect(input.getAttribute('aria-activedescendant')).toBe(option('language.form.preset_other').id)
    press(input, 'ArrowUp')
    press(input, 'Enter')
    expect(fields()).toEqual(['sv', 'sv-SE', 'Svedese', 'Svenska'])
  })

  it('shows a language already present as disabled, and does not choose it', () => {
    render(null, ['it', 'en', 'de'])
    type(picker()!, 'tede')
    const tedesco = option('Tedesco')
    expect(tedesco.getAttribute('aria-disabled')).toBe('true')
    expect(tedesco.textContent).toContain('language.form.preset_already_added')
    choose(tedesco)
    expect(fields()).toEqual(['', '', '', ''])
    press(picker()!, 'Enter')
    expect(fields()).toEqual(['', '', '', ''])
  })

  it('clears the fields and focuses Codice on "Altra lingua…"', () => {
    render(null)
    const input = picker()!
    type(input, 'tede')
    choose(option('Tedesco'))
    act(() => { input.click() })
    choose(option('language.form.preset_other'))
    expect(fields()).toEqual(['', '', '', ''])
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(field('lang-code'))
  })

  it('offers "Altra lingua…" and says so when nothing matches', () => {
    render(null)
    type(picker()!, 'zzzz')
    expect(options().map(o => o.textContent)).toEqual(['language.form.preset_other'])
    expect(document.body.textContent).toContain('language.form.preset_no_results')
  })

  it('closes only the list on Escape, keeping the dialog open', () => {
    const { onClose } = render(null)
    const input = picker()!
    type(input, 'tede')
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    press(input, 'Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
