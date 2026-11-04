import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTestTenant, tenantIdForTest } from './testing'
import { revalidateTokenTenant, updateTokenTenant } from './token-tenant'

const mocks = vi.hoisted(() => ({
  withGlobal: vi.fn(),
  listAvailableTenants: vi.fn(),
  resolveHostTenant: vi.fn(),
  resolveUserAuthorization: vi.fn(),
  resolveTenantAuthorization: vi.fn(),
}))
vi.mock('@/lib/db/tenant-db', () => ({ withGlobal: mocks.withGlobal, withTenant: vi.fn() }))
vi.mock('@/lib/rbac/auth-roles', () => ({ resolveUserAuthorization: mocks.resolveUserAuthorization, resolveTenantAuthorization: mocks.resolveTenantAuthorization }))
vi.mock('./host-tenants', () => ({
  listAvailableTenants: mocks.listAvailableTenants,
  resolveHostTenant: mocks.resolveHostTenant,
  hasDeactivatedMembershipOnHost: vi.fn(),
  hasInactiveMembershipOnHost: vi.fn().mockResolvedValue(false),
}))
vi.mock('./membership', () => ({ ensureDefaultMembership: vi.fn() }))
vi.mock('./support-consent', () => ({ selectSupportAccess: vi.fn(), supportConditionsHold: vi.fn() }))

const DEFAULT = defaultTestTenant()
const B = tenantIdForTest(9876)
const NONE = { tenantId: null, tenantState: 'none', tenantHost: 'localhost', accountActive: true }

beforeEach(() => {
  vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'single')
  mocks.withGlobal.mockResolvedValue([{ status: 2, lastTenantId: B, isPlatformAdmin: true, onDedicatedHost: false }])
  mocks.listAvailableTenants.mockResolvedValue([{ tenantId: DEFAULT, name: 'Default', isAdmin: false }])
  mocks.resolveHostTenant.mockResolvedValue(DEFAULT)
  mocks.resolveUserAuthorization.mockResolvedValue({ accountActive: true, roleIds: [], isAdmin: false, isPlatformAdmin: true })
  mocks.resolveTenantAuthorization.mockResolvedValue({ accountActive: true, roleIds: [], isAdmin: false, isPlatformAdmin: true, tenantEligible: false })
})
afterEach(() => vi.unstubAllEnvs())

describe('single token without an implicit tenant change', () => {
  it.each(['ready', 'support'])('keeps an invalid old %s token without a tenant on subsequent requests', async state => {
    const invalidated = await revalidateTokenTenant('person', { tenantId: B, tenantState: state }, 'localhost')
    expect(invalidated).toMatchObject({ tenantState: 'none', tenantId: null, roleIds: [], isPlatformAdmin: false })
    const next = await revalidateTokenTenant('person', invalidated, 'localhost')
    expect(next).toMatchObject({ tenantState: 'none', tenantId: null, roleIds: [], isPlatformAdmin: false })
  })

  it.each([{ user: { tenantId: B } }, { user: { supportTenantId: B } }, { user: { supportExit: true } }])('ignores a client selection or support update %j while there is no tenant', async payload => {
    expect(await updateTokenTenant('person', NONE, 'localhost', payload)).toMatchObject({ tenantState: 'none', tenantId: null })
  })

  it('allows an explicit retry without a tenant argument to enter the existing default membership', async () => {
    expect(await updateTokenTenant('person', NONE, 'localhost', {})).toMatchObject({ tenantState: 'ready', tenantId: DEFAULT, roleIds: [], isPlatformAdmin: false })
  })
})
