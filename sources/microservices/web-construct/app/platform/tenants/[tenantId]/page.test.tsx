import React from 'react'
import { expect, it, vi } from 'vitest'
import PlatformTenantPage from './page'

const mocks = vi.hoisted(() => ({ readUsage: vi.fn(async () => ({ members: 5, roles: 3, menuEntries: 8 })), readPolicy: vi.fn(async () => ({ revision: 3 })) }))
vi.mock('@/lib/platform/tenant-service', () => ({ getTenantForPlatform: async () => ({ id: 7, name: 'Synthetic', slug: 'synthetic' }), readTenantPolicyForPlatform: mocks.readPolicy, readTenantUsageForPlatform: mocks.readUsage }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requirePlatformAdminPage: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({ getI18n: async () => ({ t: (key: string) => key }) }))
vi.mock('@/components/platform/TenantDetail', () => ({ TenantDetail: () => null }))
vi.mock('@/components/audit/AuditTableClient', () => ({ AuditTableClient: () => null }))
it('loads the policy and tenant-wide usage through guarded ports for the detail editor', async () => {
  const page = await PlatformTenantPage({ params: Promise.resolve({ tenantId: '7' }) })
  expect(mocks.readPolicy).toHaveBeenCalledWith(7)
  expect(mocks.readUsage).toHaveBeenCalledWith(7)
  const detail = React.Children.toArray(page.props.children)[0] as React.ReactElement<{ policy: unknown; usage: unknown }>
  expect(detail.props.policy).toEqual({ revision: 3 })
  expect(detail.props.usage).toEqual({ members: 5, roles: 3, menuEntries: 8 })
})
