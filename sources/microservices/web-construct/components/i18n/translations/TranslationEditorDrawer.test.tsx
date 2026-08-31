// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import TranslationEditorDrawer from './TranslationEditorDrawer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    languages: [
      { id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano', isActive: true, isDefault: true },
    ],
  }),
}))
vi.mock('@/lib/i18n/translation-actions', () => ({ saveTranslations: vi.fn() }))

const row = {
  key: 'auth.login.title', namespace: 'auth', module: 'core',
  description: null, values: {},
} as unknown as TranslationRowDto

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('TranslationEditorDrawer suggestions', () => {
  it('offers the existing namespaces without discarding the stored value', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <TranslationEditorDrawer row={row} onClose={vi.fn()} namespaces={['auth', 'nav']} modules={['core']} />,
    ))
    const ns = document.querySelector<HTMLInputElement>('#ed-ns')!
    expect(ns.value).toBe('auth')
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    // 'auth' is already in the field, so the list is filtered down to it.
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['auth'])
  })
})
