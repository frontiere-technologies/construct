import { describe, expect, it, vi } from 'vitest'
import type { PermissionCode } from '@/lib/rbac/permission-catalog'
import type { AreaKey, FeatureKey } from './feature-catalog'

// Import nei casi: l'assenza iniziale del valutatore deve fallire i test, non la raccolta.
async function loadPolicy() {
  const catalog = await import('./feature-catalog')
  const policy = await import('./tenant-policy')
  const allAreasDisabled = Object.fromEntries(catalog.AREA_KEYS.map(key => [key, false])) as Record<AreaKey, boolean>
  return { ...catalog, ...policy, allAreasDisabled }
}

const ESSENTIAL_FEATURES = ['core-app', 'read-tenant-audit', 'manage-support-consent', 'export-tenant-data']

const AREA_FEATURES: Record<AreaKey, FeatureKey[]> = {
  people: ['read-users', 'invite-users', 'set-user-status', 'assign-user-roles'],
  roles: ['read-roles', 'manage-roles', 'grant-role-permissions'],
  navigation: ['read-menu', 'manage-menu', 'use-custom-content'],
  appearance: ['manage-tenant-theme'],
  catalogs: ['read-languages', 'read-translations'],
  'tenant-settings': ['manage-tenant-settings'],
}

describe('tenant feature policy', () => {
  it.each([
    { isAreaEnabled: true, override: undefined, expected: true },
    { isAreaEnabled: true, override: true, expected: true },
    { isAreaEnabled: true, override: false, expected: false },
    { isAreaEnabled: false, override: undefined, expected: false },
    { isAreaEnabled: false, override: true, expected: true },
    { isAreaEnabled: false, override: false, expected: false },
  ])('uses area=$isAreaEnabled, override=$override to grant=$expected', async ({ isAreaEnabled, override, expected }) => {
    const { evaluateTenantFeatures, allAreasDisabled } = await loadPolicy()
    const overrides = override === undefined ? {} : { 'read-users': override }
    const features = evaluateTenantFeatures({ ...allAreasDisabled, people: isAreaEnabled }, overrides)
    expect(features.has('read-users')).toBe(expected)
  })

  it.each(Object.entries(AREA_FEATURES))('grants the capabilities belonging to %s', async (area, expected) => {
    const { evaluateTenantFeatures, allAreasDisabled } = await loadPolicy()
    const features = evaluateTenantFeatures({ ...allAreasDisabled, [area]: true }, {})
    expect([...features].sort()).toEqual([...ESSENTIAL_FEATURES, ...expected].sort())
  })

  it('keeps essential capabilities when all areas and their overrides are disabled', async () => {
    const { evaluateTenantFeatures, allAreasDisabled } = await loadPolicy()
    const features = evaluateTenantFeatures(allAreasDisabled, {
      'core-app': false,
      'read-tenant-audit': false,
      'manage-support-consent': false,
      'export-tenant-data': false,
    })
    expect([...features].sort()).toEqual([...ESSENTIAL_FEATURES].sort())
  })

  it('does not silently grant the read capability required by an invitation', async () => {
    const { evaluateTenantFeatures, findMissingDependencies, allAreasDisabled } = await loadPolicy()
    const features = evaluateTenantFeatures(allAreasDisabled, { 'invite-users': true })
    expect(features.has('read-users')).toBe(false)
    expect(findMissingDependencies(features)).toContain('read-users')
  })

  it.each([
    ['invite-users', ['read-users']],
    ['set-user-status', ['read-users']],
    ['assign-user-roles', ['read-users', 'read-roles']],
    ['manage-roles', ['read-roles']],
    ['grant-role-permissions', ['read-roles']],
    ['manage-menu', ['read-menu']],
  ] as const)('reports required reads for %s', async (feature, expected) => {
    const { evaluateTenantFeatures, findMissingDependencies, allAreasDisabled } = await loadPolicy()
    const features = evaluateTenantFeatures(allAreasDisabled, { [feature]: true })
    expect(findMissingDependencies(features).sort()).toEqual([...expected].sort())
  })

  it('reports transitive reads even when an intermediate capability is missing', async () => {
    const catalog = await import('./feature-catalog')
    // Il catalogo attuale ha un solo livello: questa estensione controllata prova il percorso transitivo.
    vi.resetModules()
    vi.doMock('./feature-catalog', () => ({
      ...catalog,
      FEATURE_CATALOG: catalog.FEATURE_CATALOG.map(feature => feature.key === 'read-users'
        ? { ...feature, dependencies: ['read-roles'] }
        : feature),
    }))
    try {
      const { findMissingDependencies } = await import('./tenant-policy')
      expect(findMissingDependencies(new Set(['invite-users']))).toEqual(['read-users', 'read-roles'])
      expect(findMissingDependencies(new Set(['invite-users', 'read-users']))).toEqual(['read-roles'])
    } finally {
      vi.doUnmock('./feature-catalog')
      vi.resetModules()
    }
  })

  it('reports a missing dependency once even when several features require it', async () => {
    const { findMissingDependencies } = await loadPolicy()
    expect(findMissingDependencies(new Set(['invite-users', 'set-user-status']))).toEqual(['read-users'])
  })

  it('accepts a complete policy and reports no missing dependencies', async () => {
    const { AREA_KEYS, evaluateTenantFeatures, findMissingDependencies } = await loadPolicy()
    const areas = Object.fromEntries(AREA_KEYS.map(key => [key, true])) as Record<AreaKey, boolean>
    expect(findMissingDependencies(evaluateTenantFeatures(areas, {}))).toEqual([])
  })

  it('does not mutate its inputs or share results between evaluations', async () => {
    const { evaluateTenantFeatures, allAreasDisabled } = await loadPolicy()
    const areas = Object.freeze(allAreasDisabled)
    const overrides = Object.freeze({ 'read-users': true })
    const first = evaluateTenantFeatures(areas, overrides)
    expect(first.has('read-users')).toBe(true)
    expect(evaluateTenantFeatures(areas, {}).has('read-users')).toBe(false)
    expect(areas.people).toBe(false)
    expect(overrides).toEqual({ 'read-users': true })
  })

  it('rejects unknown area and capability keys at the validation boundary', async () => {
    const { areaKeySchema, featureKeySchema, tenantAreasSchema, tenantFeatureOverridesSchema, allAreasDisabled } = await loadPolicy()
    expect(areaKeySchema.safeParse('future-area').success).toBe(false)
    expect(featureKeySchema.safeParse('future-feature').success).toBe(false)
    expect(tenantAreasSchema.safeParse({ ...allAreasDisabled, 'future-area': true }).success).toBe(false)
    expect(tenantFeatureOverridesSchema.safeParse({ 'future-feature': true }).success).toBe(false)
  })

  it('rejects missing areas and non-boolean values rather than coercing them', async () => {
    const { tenantAreasSchema, tenantFeatureOverridesSchema, allAreasDisabled } = await loadPolicy()
    expect(tenantAreasSchema.safeParse({}).success).toBe(false)
    expect(tenantAreasSchema.safeParse({ ...allAreasDisabled, people: 'false' }).success).toBe(false)
    expect(tenantFeatureOverridesSchema.safeParse({ 'read-users': 1 }).success).toBe(false)
  })

  it('refuses invalid runtime configuration before evaluating capabilities', async () => {
    const { evaluateTenantFeatures, findMissingDependencies, allAreasDisabled } = await loadPolicy()
    const invalidAreas = { ...allAreasDisabled, unknown: true }
    expect(() => evaluateTenantFeatures(invalidAreas, {})).toThrow()
    expect(() => evaluateTenantFeatures(allAreasDisabled, { unknown: true } as Partial<Record<FeatureKey, boolean>>)).toThrow()
    expect(() => findMissingDependencies(new Set(['unknown' as FeatureKey]))).toThrow()
  })

  it('maps active permissions and leaves unused or unknown permissions unavailable', async () => {
    const { featureForPermission } = await loadPolicy()
    expect(featureForPermission('invite-users')).toBe('invite-users')
    expect(featureForPermission('read-tenant-audit')).toBe('read-tenant-audit')
    for (const code of ['manage-permissions', 'manage-languages', 'edit-translations', 'manage-translation-keys'] as const) {
      expect(featureForPermission(code)).toBeNull()
    }
    expect(featureForPermission('unknown' as PermissionCode)).toBeNull()
  })
})
