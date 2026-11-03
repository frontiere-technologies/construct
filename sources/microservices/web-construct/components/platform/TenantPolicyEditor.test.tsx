// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { saveTenantPolicy, purgeTenantGrants, previewTenantGrantPurge } from '@/lib/platform/tenant-policy-actions'
import { AREA_KEYS } from '@/lib/tenancy/feature-catalog'
import { evaluateTenantFeatures } from '@/lib/tenancy/tenant-policy'
import type { TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { TenantPolicyEditor } from './TenantPolicyEditor'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? JSON.stringify(values) : '') }) }))
vi.mock('@/lib/platform/tenant-policy-actions', () => ({ saveTenantPolicy: vi.fn(), purgeTenantGrants: vi.fn(), previewTenantGrantPurge: vi.fn() }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const areas = Object.fromEntries(AREA_KEYS.map(key => [key, true])) as TenantPolicySnapshot['areas']
const policy: TenantPolicySnapshot = { revision: 3, areas, overrides: {}, limits: { queryTimeoutMs: null, maxMembers: null, maxRoles: null, maxMenuEntries: null }, enabledFeatures: [...evaluateTenantFeatures(areas, {})] }
let root: Root
beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveTenantPolicy).mockResolvedValue({ ok: true, revision: 4 }) })
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren() })
function render(initialPolicy = policy) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<TenantPolicyEditor tenantId={7} initialPolicy={initialPolicy} usage={{ members: 5, roles: 3, menuEntries: 8 }} />)) }
function button(name: string) { return Array.from(document.querySelectorAll('button')).find(node => node.textContent === name)! }
async function click(node: HTMLElement) { await act(async () => node.click()) }
function select(key: string, value: string) { act(() => { const node = document.querySelector<HTMLSelectElement>(`select[data-feature="${key}"]`)!; node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })) }) }
it('offers inherit allow deny and explains the source of effective values', () => { render(); const node = document.querySelector<HTMLSelectElement>('select[data-feature="read-users"]')!; expect([...node.options].map(option => option.value)).toEqual(['inherit', 'allow', 'deny']); expect(document.body.textContent).toContain('platform.policy.source.area'); select('read-users', 'deny'); expect(document.body.textContent).toContain('platform.policy.source.override') })
it('save never purges role assignments', async () => {
  render()
  await click(document.querySelector<HTMLInputElement>('input[data-area="people"]')!)
  await click(button('common.actions.save'))
  expect(saveTenantPolicy).toHaveBeenCalledOnce()
  expect(purgeTenantGrants).not.toHaveBeenCalled()
  expect(saveTenantPolicy).toHaveBeenCalledWith(7, expect.objectContaining({ areas: expect.objectContaining({ people: false }) }))
  expect(document.body.textContent).toContain('platform.policy.saved')
})
it('shows missing dependencies and refuses saving an inconsistent draft', async () => { render(); select('read-users', 'deny'); expect(document.body.textContent).toContain('platform.policy.dependencies'); expect(button('common.actions.save').disabled).toBe(true); expect(saveTenantPolicy).not.toHaveBeenCalled() })
it('warns when a quota is lower than current usage without deleting data', () => { render({ ...policy, limits: { ...policy.limits, maxMembers: 2 } }); expect(document.body.textContent).toContain('platform.policy.quota_below_usage'); expect(purgeTenantGrants).not.toHaveBeenCalled() })
it('keeps a revision conflict visible and requires reload before retry', async () => { vi.mocked(saveTenantPolicy).mockResolvedValue({ ok: false, reason: 'conflict' }); render(); await click(button('common.actions.save')); expect(document.querySelector('[role="alert"]')?.textContent).toContain('platform.policy.conflict'); expect(button('common.actions.save').disabled).toBe(true) })
it('previews only saved suspended features, respecting explicit exceptions in an area', async () => { const suspended = { ...areas, people: false }; const overrides = { 'read-users': true } as const; render({ ...policy, areas: suspended, overrides, enabledFeatures: [...evaluateTenantFeatures(suspended, overrides)] }); await click(document.querySelector<HTMLInputElement>('input[data-purge-area="people"]')!); vi.mocked(previewTenantGrantPurge).mockResolvedValue({ revision: 3, keys: ['invite-users', 'set-user-status', 'assign-user-roles'], roleCount: 2, permissionGrantCount: 3, menuGrantCount: 1, fingerprint: 'a'.repeat(64) }); await click(button('platform.policy.purge.preview')); expect(previewTenantGrantPurge).toHaveBeenCalledWith(7, ['invite-users', 'set-user-status', 'assign-user-roles']); expect(purgeTenantGrants).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('platform.policy.suspended_preserved') })
