// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/providers'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/context/I18nContext', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/context/UIContext', () => ({
  UIProvider: ({ children }: { children: React.ReactNode }) => children,
}))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.documentElement.removeAttribute('data-app-hydrated')
})

describe('Providers hydration readiness', () => {
  it('marks the document ready after hydration and clears the marker on unmount', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => root?.render(<Providers i18n={{} as never}>content</Providers>))

    expect(document.documentElement.getAttribute('data-app-hydrated')).toBe('true')

    act(() => root?.unmount())
    root = undefined
    expect(document.documentElement.hasAttribute('data-app-hydrated')).toBe(false)
  })
})
