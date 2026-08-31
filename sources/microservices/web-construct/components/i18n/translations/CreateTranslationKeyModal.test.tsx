// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreateTranslationKeyModal from './CreateTranslationKeyModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/i18n/translation-actions', () => ({ createTranslationKey: vi.fn() }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

function open() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <CreateTranslationKeyModal onClose={vi.fn()} namespaces={['auth', 'common']} modules={['core', 'rbac']} />,
  ))
}

describe('CreateTranslationKeyModal suggestions', () => {
  it('suggests the namespaces already in use', () => {
    open()
    const ns = document.querySelector<HTMLInputElement>('#tk-ns')!
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent))
      .toEqual(['auth', 'common'])
  })

  it('suggests the modules already in use', () => {
    open()
    const mod = document.querySelector<HTMLInputElement>('#tk-mod')!
    expect(mod.getAttribute('role')).toBe('combobox')
    act(() => mod.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent))
      .toEqual(['core', 'rbac'])
  })
})
