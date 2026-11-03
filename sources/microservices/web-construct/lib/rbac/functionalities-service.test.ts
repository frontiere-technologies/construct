import { expect, it, vi } from 'vitest'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import { AREA_KEYS, FEATURE_KEYS } from '@/lib/tenancy/feature-catalog'
import { getMenuEditorAreas } from './functionalities-service'

const mocks = vi.hoisted(() => ({ policy: {} }))
vi.mock('@/lib/db/tenant-db', () => ({ withTenant: async (_id: unknown, fn: (tx: unknown) => unknown) => fn({}) }))
vi.mock('@/lib/tenancy/tenant-policy-service', () => ({ selectTenantPolicy: async () => mocks.policy }))
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
it('offers category areas separately from custom content using T03 effective exceptions', async () => {
  mocks.policy = { areas: { people: false, roles: true, navigation: false, appearance: true, catalogs: true, 'tenant-settings': true }, enabledFeatures: [...FEATURE_KEYS] }
  const areas = await getMenuEditorAreas(tenantIdForTest(7))
  expect(areas.category).toEqual(AREA_KEYS.filter(key => key !== 'people' && key !== 'navigation'))
  expect(areas.content).toEqual(AREA_KEYS.filter(key => key !== 'people'))
  mocks.policy = { ...mocks.policy, enabledFeatures: FEATURE_KEYS.filter(key => key !== 'use-custom-content') }
  expect((await getMenuEditorAreas(tenantIdForTest(7))).content).toEqual([])
})
