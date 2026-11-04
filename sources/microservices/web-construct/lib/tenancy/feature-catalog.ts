import { z } from 'zod'
import type { PermissionCode } from '@/lib/rbac/permission-catalog'

export const AREA_KEYS = Object.freeze([
  'people', 'roles', 'navigation', 'appearance', 'catalogs', 'tenant-settings',
] as const)

export type AreaKey = (typeof AREA_KEYS)[number]

export const FEATURE_KEYS = Object.freeze([
  'read-users', 'invite-users', 'set-user-status', 'assign-user-roles',
  'read-roles', 'manage-roles', 'grant-role-permissions',
  'read-menu', 'manage-menu', 'use-custom-content',
  'manage-tenant-theme', 'read-languages', 'read-translations', 'manage-tenant-settings',
  'core-app', 'read-tenant-audit', 'manage-support-consent', 'export-tenant-data',
] as const)

export type FeatureKey = (typeof FEATURE_KEYS)[number]

interface FeatureDefinition {
  readonly key: FeatureKey
  /** null identifica il nucleo essenziale, che la piattaforma non può disabilitare. */
  readonly area: AreaKey | null
  readonly permission: PermissionCode | null
  readonly dependencies: readonly FeatureKey[]
}

export const FEATURE_CATALOG = Object.freeze(([
  { key: 'read-users', area: 'people', permission: 'read-users', dependencies: [] },
  { key: 'invite-users', area: 'people', permission: 'invite-users', dependencies: ['read-users'] },
  { key: 'set-user-status', area: 'people', permission: 'set-user-status', dependencies: ['read-users'] },
  { key: 'assign-user-roles', area: 'people', permission: 'assign-user-roles', dependencies: ['read-users', 'read-roles'] },
  { key: 'read-roles', area: 'roles', permission: 'read-roles', dependencies: [] },
  { key: 'manage-roles', area: 'roles', permission: 'manage-roles', dependencies: ['read-roles'] },
  { key: 'grant-role-permissions', area: 'roles', permission: 'grant-role-permissions', dependencies: ['read-roles'] },
  { key: 'read-menu', area: 'navigation', permission: 'read-menu', dependencies: [] },
  { key: 'manage-menu', area: 'navigation', permission: 'manage-menu', dependencies: ['read-menu'] },
  { key: 'use-custom-content', area: 'navigation', permission: null, dependencies: [] },
  { key: 'manage-tenant-theme', area: 'appearance', permission: null, dependencies: [] },
  { key: 'read-languages', area: 'catalogs', permission: 'read-languages', dependencies: [] },
  { key: 'read-translations', area: 'catalogs', permission: 'read-translations', dependencies: [] },
  { key: 'manage-tenant-settings', area: 'tenant-settings', permission: 'manage-tenant-settings', dependencies: [] },
  { key: 'core-app', area: null, permission: null, dependencies: [] },
  { key: 'read-tenant-audit', area: null, permission: 'read-tenant-audit', dependencies: [] },
  { key: 'manage-support-consent', area: null, permission: 'manage-support-consent', dependencies: [] },
  { key: 'export-tenant-data', area: null, permission: null, dependencies: [] },
] as const satisfies readonly FeatureDefinition[]).map(feature => {
  Object.freeze(feature.dependencies)
  return Object.freeze(feature)
}))

export const areaKeySchema = z.enum(AREA_KEYS)
export const featureKeySchema = z.enum(FEATURE_KEYS)
export const tenantAreasSchema = z.record(areaKeySchema, z.boolean())
export const tenantFeatureOverridesSchema = z.partialRecord(featureKeySchema, z.boolean())

/** I codici inutilizzati o non mappati non ricevono una capacità per difetto. */
export function featureForPermission(code: PermissionCode): FeatureKey | null {
  return FEATURE_CATALOG.find(feature => feature.permission === code)?.key ?? null
}
