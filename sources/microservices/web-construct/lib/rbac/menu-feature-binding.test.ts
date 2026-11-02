import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS, AREA_KEYS } from '@/lib/tenancy/feature-catalog'
import type { TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { bindMenuTarget, canUseMenuEntry } from './menu-feature-binding'

const origin = 'https://construct.example.test'
const policy: TenantPolicySnapshot = {
  revision: 1, areas: Object.fromEntries(AREA_KEYS.map(key => [key, true])) as TenantPolicySnapshot['areas'],
  overrides: {}, enabledFeatures: [...FEATURE_KEYS],
  limits: { queryTimeoutMs: null, maxMembers: null, maxRoles: null, maxMenuEntries: null },
}

describe('menu feature binding', () => {
  it.each([
    '/user-management', 'user-management', '/user-management/?sort=name#grid',
    'https://construct.example.test/user-management/?sort=name#grid',
    '//construct.example.test/user-management', '/other/../user-management', '/%75ser-management',
  ])('binds alias %s to the internal users capability even when declared external', link => {
    expect(bindMenuTarget({ link, functionalityType: 2, areaKey: 'people' }, origin))
      .toEqual({ areaKey: 'people', featureKey: 'read-users' })
  })

  it.each([1, 2])('binds genuine external content of type %i to custom content', functionalityType => {
    expect(bindMenuTarget({ link: 'https://example.net/user-management', functionalityType, areaKey: null }, origin))
      .toEqual({ areaKey: 'navigation', featureKey: 'use-custom-content' })
  })

  it('keeps a neutral container independent of its children areas', () => {
    expect(bindMenuTarget({ link: null, functionalityType: null, areaKey: null }, origin))
      .toEqual({ areaKey: null, featureKey: null })
    expect(canUseMenuEntry(policy, { areaKey: null, featureKey: null })).toBe(true)
  })

  it('keeps the shared tenant settings page essential for support consent', () => {
    expect(bindMenuTarget({ link: '/admin/tenant-settings', functionalityType: 3, areaKey: null }, origin))
      .toEqual({ areaKey: null, featureKey: 'manage-support-consent' })
  })

  it('rejects an incompatible presentation area for an internal capability', () => {
    expect(() => bindMenuTarget({ link: '/user-management', functionalityType: 3, areaKey: 'roles' }, origin)).toThrow()
  })

  it('does not cancel an explicit feature exception in its own disabled area', () => {
    const suspended = { ...policy, areas: { ...policy.areas, people: false }, overrides: { 'read-users': true } }
    expect(canUseMenuEntry(suspended, { areaKey: 'people', featureKey: 'read-users' })).toBe(true)
  })

  it('requires custom content and any separate presentation area', () => {
    const suspended = { ...policy, areas: { ...policy.areas, people: false } }
    expect(canUseMenuEntry(suspended, { areaKey: 'people', featureKey: 'use-custom-content' })).toBe(false)
    expect(canUseMenuEntry({ ...policy, enabledFeatures: policy.enabledFeatures.filter(key => key !== 'use-custom-content') },
      { areaKey: 'navigation', featureKey: 'use-custom-content' })).toBe(false)
  })

  it('denies a suspended internal feature even with its area enabled', () => {
    expect(canUseMenuEntry({ ...policy, enabledFeatures: policy.enabledFeatures.filter(key => key !== 'read-users') },
      { areaKey: 'people', featureKey: 'read-users' })).toBe(false)
  })
})

describe('real route inventory', () => {
  it.each([
    ['/roles-permissions', 'roles', 'read-roles'], ['/roles-permissions/12', 'roles', 'read-roles'],
    ['/functionalities', 'navigation', 'read-menu'], ['/functionalities/create', 'navigation', 'manage-menu'],
    ['/functionalities/12/edit', 'navigation', 'manage-menu'],
    ['/admin/theme', 'appearance', 'manage-tenant-theme'], ['/admin/languages', 'catalogs', 'read-languages'],
    ['/admin/translations', 'catalogs', 'read-translations'], ['/admin/audit', null, 'read-tenant-audit'],
    ['/', null, 'core-app'], ['/profile', null, 'core-app'], ['/settings', null, 'core-app'],
    ['/select-tenant', null, 'core-app'], ['/a-generic-home-page', null, 'core-app'],
  ] as const)('binds %s to its own capability', (link, areaKey, featureKey) => {
    expect(bindMenuTarget({ link, functionalityType: 3, areaKey: null }, origin)).toEqual({ areaKey, featureKey })
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@construct.example.test/user-management'])('rejects unsafe URL %s', link => {
    expect(() => bindMenuTarget({ link, functionalityType: 2, areaKey: null }, origin)).toThrow()
  })

  it('does not accept an external URL as an internal functionality', () => {
    expect(() => bindMenuTarget({ link: 'https://example.net', functionalityType: 3, areaKey: null }, origin)).toThrow()
  })

  it('rejects a category carrying a URL and a functionality without one', () => {
    expect(() => bindMenuTarget({ link: '/user-management', functionalityType: null, areaKey: null }, origin)).toThrow()
    expect(() => bindMenuTarget({ link: null, functionalityType: 3, areaKey: null }, origin)).toThrow()
  })
})

it('keeps relative menu targets usable without a configured public origin', () => {
  expect(bindMenuTarget({ link: '/user-management', functionalityType: 3, areaKey: null }, '')).toEqual({ areaKey: 'people', featureKey: 'read-users' })
  expect(() => bindMenuTarget({ link: '//construct.example.test/user-management', functionalityType: 2, areaKey: null }, '')).toThrow(/origin_required/)
})
