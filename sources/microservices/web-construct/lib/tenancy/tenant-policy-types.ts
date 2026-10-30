import type { AreaKey, FeatureKey } from './feature-catalog'

export interface TenantLimits {
  queryTimeoutMs: number | null
  maxMembers: number | null
  maxRoles: number | null
  maxMenuEntries: number | null
}

export interface TenantPolicySnapshot {
  revision: number
  areas: Record<AreaKey, boolean>
  overrides: Partial<Record<FeatureKey, boolean>>
  limits: TenantLimits
  enabledFeatures: FeatureKey[]
}

export interface TenantPolicyDraft {
  expectedRevision: number
  areas: Record<AreaKey, boolean>
  overrides: Partial<Record<FeatureKey, boolean>>
  limits: TenantLimits
}
