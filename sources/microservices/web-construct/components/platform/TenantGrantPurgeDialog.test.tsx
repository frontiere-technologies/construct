// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { purgeTenantGrants, previewTenantGrantPurge } from '@/lib/platform/tenant-policy-actions'
import type { PurgePreview } from '@/lib/platform/tenant-policy-schemas'
import { TenantGrantPurgeDialog } from './TenantGrantPurgeDialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? JSON.stringify(values) : '') }) }))
vi.mock('@/lib/platform/tenant-policy-actions', () => ({ purgeTenantGrants: vi.fn(), previewTenantGrantPurge: vi.fn() }))
const preview: PurgePreview = { revision: 3, keys: ['read-users'], roleCount: 2, permissionGrantCount: 5, menuGrantCount: 4, fingerprint: 'a'.repeat(64) }
let root: Root
const complete = vi.fn()
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.clearAllMocks() })
function render() { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<TenantGrantPurgeDialog tenantId={7} preview={preview} onComplete={complete} />)) }
function button(name: string) { return Array.from(document.querySelectorAll('button')).find(node => node.textContent === name)! }
async function click(name: string) { await act(async () => button(name).click()) }
it('shows affected roles and individual permission/menu assignments and waits for explicit confirmation', async () => { render(); await click('platform.policy.purge.open'); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('"roles":2,"permissions":5,"menus":4'); expect(purgeTenantGrants).not.toHaveBeenCalled(); vi.mocked(purgeTenantGrants).mockResolvedValue({ ok: true, revision: 4 }); await click('platform.policy.purge.confirm'); expect(purgeTenantGrants).toHaveBeenCalledWith(7, preview); expect(complete).toHaveBeenCalledOnce() })
it('never retries a stale preview: refreshes counts and requires a new explicit confirmation', async () => { render(); await click('platform.policy.purge.open'); vi.mocked(purgeTenantGrants).mockResolvedValue({ ok: false, reason: 'conflict' }); await click('platform.policy.purge.confirm'); expect(button('platform.policy.purge.confirm').disabled).toBe(true); const updated = { ...preview, permissionGrantCount: 3, fingerprint: 'b'.repeat(64) }; vi.mocked(previewTenantGrantPurge).mockResolvedValue(updated); await click('platform.policy.purge.refresh'); expect(purgeTenantGrants).toHaveBeenCalledOnce(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('"permissions":3'); vi.mocked(purgeTenantGrants).mockResolvedValue({ ok: true, revision: 4 }); await click('platform.policy.purge.confirm'); expect(purgeTenantGrants).toHaveBeenLastCalledWith(7, updated) })
