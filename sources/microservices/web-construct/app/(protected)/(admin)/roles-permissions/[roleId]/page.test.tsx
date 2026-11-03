import React from 'react'
import { expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/rbac/actor'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import { AREA_KEYS } from '@/lib/tenancy/feature-catalog'
import { evaluateTenantFeatures } from '@/lib/tenancy/tenant-policy'
import RoleDetailPage from './page'

const mocks = vi.hoisted(() => ({ actor: {} as Actor, context: {}, grantable: { operationIds: [], functionalityIds: [] } }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requirePagePermission: async () => mocks.actor }))
vi.mock('@/lib/db/tenant-db', () => ({ withTenant: async (_id: unknown, fn: (tx: unknown) => unknown) => fn({ select: () => ({ from: () => ({ where: async () => [{ id: 1, code: 'read-users' }, { id: 2, code: 'read-menu' }] }) }) }) }))
vi.mock('@/lib/rbac/roles-service', () => ({ getRole: async () => ({ id: 7 }), getRoleAuthorizationTree: async () => ({ operations: [{ id: 1, type: 'FUNCTIONALITY', children: [] }, { id: 2, type: 'FUNCTIONALITY', children: [] }], functionalities: [{ id: 11, type: 'FUNCTIONALITY', children: [] }, { id: 12, type: 'FUNCTIONALITY', children: [] }] }) }))
vi.mock('@/lib/rbac/grant-service', () => ({ grantableItemIds: async () => mocks.grantable, selectTenantGrantContext: async () => mocks.context }))
vi.mock('@/components/rbac/roles/RoleDetailClient', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found') } }))
vi.mock('@/lib/db/schema', () => ({ permission: { idPermission: {}, code: {} } }))
it('passes suspension separately from lack of delegation using the server grant context', async () => {
  const areas = Object.fromEntries(AREA_KEYS.map(key => [key, key !== 'people'])) as Record<(typeof AREA_KEYS)[number], boolean>
  const policy = { revision: 1, areas, overrides: {}, limits: { maxMembers: null, maxRoles: null, maxMenuEntries: null, queryTimeoutMs: null }, enabledFeatures: [...evaluateTenantFeatures(areas, {})] }
  mocks.actor = { userId: 'synthetic', isAdmin: false, isPlatformAdmin: false, canManageSupportConsent: false, tenantId: tenantIdForTest(7), roleIds: [], permissions: new Set(['read-roles', 'grant-role-permissions']), features: new Set(policy.enabledFeatures) } as Actor
  mocks.context = { policy, menuBindings: new Map([[11, { featureKey: 'read-users', areaKey: 'people' }], [12, { featureKey: 'read-menu', areaKey: 'navigation' }]]), visible: new Set(), permissionFeatures: new Map() }
  const result = await RoleDetailPage({ params: Promise.resolve({ roleId: '7' }) })
  expect((result as React.ReactElement<{ suspended: { functionalityIds: number[]; operationIds: number[] } }>).props.suspended).toEqual({ functionalityIds: [11], operationIds: [1] })
})
