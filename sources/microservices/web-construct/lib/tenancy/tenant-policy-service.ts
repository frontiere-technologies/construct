import { sql } from 'drizzle-orm'
import type { PlatformAuditTx } from '@/lib/audit/audit-types'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { AREA_KEYS, FEATURE_KEYS, featureKeySchema, tenantAreasSchema, tenantFeatureOverridesSchema } from './feature-catalog'
import type { TenantId } from './tenant-id'
import type { TenantPolicySnapshot } from './tenant-policy-types'

/** Fotografia unica dell'istruzione; nessun blocco o cache fra richieste. */
export async function selectTenantPolicy(tx: TenantTx | PlatformAuditTx): Promise<TenantPolicySnapshot> {
  const [row] = await tx.execute<{
    revision: string
    areas: Record<string, boolean>
    overrides: Record<string, boolean>
    query_timeout_ms: number | null
    max_members: number | null
    max_roles: number | null
    max_menu_entries: number | null
    features: string[]
  }>(sql`
    select p.revision::text,
      coalesce((select jsonb_object_agg(a.area_code, a.enabled) from public.tenant_area_entitlement a), '{}'::jsonb) as areas,
      coalesce((select jsonb_object_agg(e.feature_code, e.allowed) from public.tenant_entitlement e), '{}'::jsonb) as overrides,
      p.query_timeout_ms, p.max_members, p.max_roles, p.max_menu_entries,
      array(select f.code from app_private.effective_tenant_feature_codes() f) as features
    from public.tenant_platform_policy p where p.id_tenant = app_private.current_tenant_id()`)
  if (!row) throw new Error('tenant_policy_missing')
  const revision = Number(row.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid_tenant_policy_revision')
  const enabled = new Set(row.features.map(code => featureKeySchema.parse(code)))
  return {
    revision,
    // Un'area aggiunta da una migrazione futura resta spenta finché non è concessa al tenant.
    areas: tenantAreasSchema.parse({ ...Object.fromEntries(AREA_KEYS.map(key => [key, false])), ...row.areas }),
    overrides: tenantFeatureOverridesSchema.parse(row.overrides),
    limits: { queryTimeoutMs: row.query_timeout_ms, maxMembers: row.max_members, maxRoles: row.max_roles, maxMenuEntries: row.max_menu_entries },
    enabledFeatures: FEATURE_KEYS.filter(key => enabled.has(key)),
  }
}

export function readTenantPolicy(tenantId: TenantId): Promise<TenantPolicySnapshot> {
  return withTenant(tenantId, selectTenantPolicy)
}
