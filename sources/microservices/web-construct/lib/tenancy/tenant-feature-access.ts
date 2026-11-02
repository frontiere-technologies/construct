import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import type { Actor } from '@/lib/rbac/actor'
import type { FeatureKey } from './feature-catalog'
import { lockTenantPolicy } from './tenant-policy-lock'
import { selectTenantPolicy } from './tenant-policy-service'

/** Serializza la scrittura con le modifiche della policy e rivalida dopo il blocco. */
export function withTenantFeature<T>(actor: Actor, feature: FeatureKey, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return withTenant(actor.tenantId, async tx => {
    await lockTenantPolicy(tx)
    const policy = await selectTenantPolicy(tx)
    if (!policy.enabledFeatures.includes(feature)) throw new Error('Unauthorized')
    return fn(tx)
  })
}
