// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TenantStatusBadge } from './TenantStatusBadge'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function badge(status: 'active' | 'suspended' | 'archived'): HTMLElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<TenantStatusBadge status={status} />))
  return container.querySelector<HTMLElement>('[data-testid="tenant-status-badge"]')!
}

describe('TenantStatusBadge', () => {
  it.each([
    ['active', 'platform.tenants.status.active'],
    ['suspended', 'platform.tenants.status.suspended'],
    ['archived', 'platform.tenants.status.archived'],
  ] as const)('says %s with its own label', (status, label) => {
    const element = badge(status)
    expect(element.textContent).toBe(label)
    expect(element.dataset.status).toBe(status)
  })

  it('does not use the active colours for a tenant that is not active', () => {
    expect(badge('active').className).toContain('bg-success-muted')
    act(() => root?.unmount())
    expect(badge('suspended').className).not.toContain('bg-success-muted')
  })
})
