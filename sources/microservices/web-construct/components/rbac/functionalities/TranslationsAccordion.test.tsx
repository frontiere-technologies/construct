// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TranslationsAccordion from './TranslationsAccordion'

// This assignment must not follow an expression statement: a line opening with (
// would be parsed as a call on the previous statement's result. Vitest hoists
// vi.mock() above every import regardless of source position, so order is safe.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

describe('TranslationsAccordion navigation locales', () => {
  it('renders exactly the configured database languages, including an inactive authored locale', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <TranslationsAccordion
          locales={[
            { code: 'IT', label: 'Italiano', isActive: true, isDefault: true },
            { code: 'JA', label: '日本語', isActive: false, isDefault: false },
          ]}
          translations={{}}
          tags={{}}
          onTranslations={() => {}}
          onTags={() => {}}
        />,
      )
    })

    expect(container.textContent).toContain('Italiano')
    expect(container.textContent).toContain('日本語')
    expect(container.textContent).not.toContain('functionalities.locale.en')
  })
})
