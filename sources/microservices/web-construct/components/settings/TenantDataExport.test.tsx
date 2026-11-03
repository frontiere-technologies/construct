// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const { TenantDataExport } = await import('./TenantDataExport')
const runtime = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
runtime.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tenant data export control', () => {
  it('downloads only after a successful authenticated response and revokes the browser URL', async () => {
    const create = vi.fn(() => 'blob:private-test')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['{}']) }))
    vi.stubGlobal('fetch', fetch)
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    act(() => root.render(<TenantDataExport />))
    await act(async () => container.querySelector('button')!.click())
    expect(fetch).toHaveBeenCalledWith('/api/tenant/export', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
    expect(download).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:private-test')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a local failure and never creates a download after an authorization or limit failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const create = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
    act(() => root.render(<TenantDataExport />))
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('tenancy.export.failed')
    expect(create).not.toHaveBeenCalled()
    expect(container.querySelector('button')!.disabled).toBe(false)
  })
})
