import { expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/rbac/actor'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import TenantSettingsPage from './page'

const mocks = vi.hoisted(() => ({ actor: {} as Actor, guard: vi.fn() }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requireTenantSettingsPage: async () => { mocks.guard(); return mocks.actor } }))
vi.mock('@/lib/db/tenant-db', () => ({ withTenant: async (_id: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/tenancy/tenant-settings', () => ({ readSelfRegistration: async () => true, selfRegistrationApplies: async () => true }))
vi.mock('@/lib/tenancy/support-consent', () => ({ readSupportConsent: async () => ({ until: null }), readSupportInProgress: async () => false }))
vi.mock('@/components/settings/TenantSettings', () => ({ TenantSettings: () => null }))
function actor(support?: true): Actor { return { userId: 'synthetic', tenantId: tenantIdForTest(7), roleIds: [], isAdmin: support === true, isPlatformAdmin: support === true, features: new Set(['manage-support-consent']), permissions: new Set(), canManageSupportConsent: true, support } }
it('keeps delegated essential consent available when optional self registration is suspended', async () => { mocks.actor = actor(); const page = await TenantSettingsPage(); expect(mocks.guard).toHaveBeenCalled(); expect(page.props.canManageSettings).toBe(false); expect(page.props.support.locked).toBe(false) })
it('locks consent during assistance even if the actor has the dedicated delegation', async () => { mocks.actor = actor(true); const page = await TenantSettingsPage(); expect(page.props.support.locked).toBe(true); expect(page.props.canManageSettings).toBe(false) })
