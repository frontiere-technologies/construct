import {
  FEATURE_CATALOG,
  tenantAreasSchema,
  tenantFeatureOverridesSchema,
  featureKeySchema,
} from './feature-catalog'
import type { AreaKey, FeatureKey } from './feature-catalog'

/** Le eccezioni prevalgono sull'area; il nucleo essenziale resta sempre concesso. */
export function evaluateTenantFeatures(
  areas: Record<AreaKey, boolean>,
  overrides: Partial<Record<FeatureKey, boolean>>,
): ReadonlySet<FeatureKey> {
  const validatedAreas = tenantAreasSchema.parse(areas)
  const validatedOverrides = tenantFeatureOverridesSchema.parse(overrides)
  return new Set(FEATURE_CATALOG
    .filter(feature => feature.area === null || (validatedOverrides[feature.key] ?? validatedAreas[feature.area]))
    .map(feature => feature.key))
}

/** Segnala le letture mancanti senza concederle e senza modificare l'insieme ricevuto. */
export function findMissingDependencies(features: ReadonlySet<FeatureKey>): FeatureKey[] {
  for (const feature of features) featureKeySchema.parse(feature)
  const dependencies = new Map<FeatureKey, readonly FeatureKey[]>(FEATURE_CATALOG.map(feature => [feature.key, feature.dependencies]))
  const missing = new Set<FeatureKey>()
  const visited = new Set<FeatureKey>()
  const visit = (key: FeatureKey): void => {
    if (visited.has(key)) return
    visited.add(key)
    for (const dependency of dependencies.get(key) ?? []) {
      if (!features.has(dependency)) missing.add(dependency)
      visit(dependency)
    }
  }
  for (const feature of features) visit(feature)
  return FEATURE_CATALOG.filter(feature => missing.has(feature.key)).map(feature => feature.key)
}
