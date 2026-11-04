'use server'

import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { auditActorOf, type AuditEvent } from '@/lib/audit/audit-types'
import { recordPlatformAudit } from '@/lib/audit/platform-audit'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { tenant, tenantAreaEntitlement, tenantEntitlement, tenantPlatformPolicy } from '@/lib/db/schema'
import { requirePlatformAdmin, type PlatformActor } from '@/lib/rbac/auth-guard'
import { FEATURE_CATALOG, FEATURE_KEYS, type FeatureKey } from '@/lib/tenancy/feature-catalog'
import { existingTenantId } from '@/lib/tenancy/platform-tenant'
import { evaluateTenantFeatures, findMissingDependencies } from '@/lib/tenancy/tenant-policy'
import { lockTenantPolicy } from '@/lib/tenancy/tenant-policy-lock'
import { selectTenantPolicy } from '@/lib/tenancy/tenant-policy-service'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { TenantPolicyDraft, TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { withPlatform, type PlatformTx } from './db'
import { tenantIdArgSchema } from './tenant-action-schemas'
import { purgeKeysSchema, purgePreviewSchema, tenantPolicyDraftSchema, type PolicyActionResult, type PurgePreview } from './tenant-policy-schemas'

export type { PolicyActionResult, PurgePreview } from './tenant-policy-schemas'

async function lockedPolicy(tx: PlatformTx, tenantId: TenantId): Promise<TenantPolicySnapshot> {
  await lockTenantPolicy(tx)
  const [row] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, tenantId)).for('update')
  if (!row) throw new Error('tenant_not_found')
  return selectTenantPolicy(tx)
}

async function recordBoth(tx: PlatformTx, actor: PlatformActor, tenantId: TenantId, event: AuditEvent): Promise<void> {
  await recordPlatformAudit(tx, auditActorOf(actor), { ...event, tenantId })
  await recordTenantAudit(tx, auditActorOf(actor), event)
}

function differences(before: object, after: object): Record<string, { from: unknown; to: unknown }> {
  const oldValues = Object.fromEntries(Object.entries(before))
  const newValues = Object.fromEntries(Object.entries(after))
  return Object.fromEntries([...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
    .filter(key => oldValues[key] !== newValues[key])
    .map(key => [key, { from: oldValues[key] ?? null, to: newValues[key] ?? null }]))
}

/** Il blocco resta chiuso fino alla sostituzione di tutte le vecchie immagini. */
export async function saveTenantPolicy(tenantId: number, draft: TenantPolicyDraft): Promise<PolicyActionResult> {
  const actor = await requirePlatformAdmin()
  if (process.env.CONSTRUCT_PLATFORM_POLICY_WRITES !== '1') return { ok: false, reason: 'disabled' }
  const parsedId = tenantIdArgSchema.safeParse(tenantId)
  const parsed = tenantPolicyDraftSchema.safeParse(draft)
  if (!parsedId.success || !parsed.success) return { ok: false, reason: 'invalid' }
  const value = parsed.data
  if (findMissingDependencies(evaluateTenantFeatures(value.areas, value.overrides)).length) return { ok: false, reason: 'invalid' }
  const tenantKey = await existingTenantId(parsedId.data)

  return withPlatform<PolicyActionResult>(async tx => {
    const previous = await lockedPolicy(tx, tenantKey)
    if (previous.revision !== value.expectedRevision) return { ok: false, reason: 'conflict' }
    await tx.delete(tenantAreaEntitlement).where(eq(tenantAreaEntitlement.idTenant, tenantKey))
    await tx.insert(tenantAreaEntitlement).values(Object.entries(value.areas).map(([areaCode, enabled]) => ({ areaCode, enabled })))
    await tx.delete(tenantEntitlement).where(eq(tenantEntitlement.idTenant, tenantKey))
    const overrides = Object.entries(value.overrides).map(([featureCode, allowed]) => ({ featureCode, allowed }))
    if (overrides.length) await tx.insert(tenantEntitlement).values(overrides)
    const revision = previous.revision + 1
    await tx.update(tenantPlatformPolicy).set({ ...value.limits, revision }).where(eq(tenantPlatformPolicy.idTenant, tenantKey))
    await recordBoth(tx, actor, tenantKey, {
      operation: 'tenant.policy.save', objectType: 'tenant_platform_policy', objectId: tenantKey,
      details: {
        revision: { from: previous.revision, to: revision },
        areas: differences(previous.areas, value.areas),
        overrides: differences(previous.overrides, value.overrides),
        limits: differences(previous.limits, value.limits),
      },
    })
    return { ok: true, revision }
  }, tenantKey)
}

function canPurge(policy: TenantPolicySnapshot, keys: FeatureKey[]): boolean {
  return keys.every(key => FEATURE_CATALOG.some(feature => feature.key === key && feature.area !== null) && !policy.enabledFeatures.includes(key))
}

interface GrantId {
  role: string
  target: string
}

interface SelectedGrants {
  permissions: GrantId[]
  menus: GrantId[]
  preview: PurgePreview
}

async function selectPurge(tx: PlatformTx, tenantId: TenantId, policy: TenantPolicySnapshot, selectedKeys: FeatureKey[], shouldLockGrants = false): Promise<SelectedGrants> {
  const keys = FEATURE_KEYS.filter(key => selectedKeys.includes(key))
  const list = sql.join(keys.map(key => sql`${key}`), sql`, `)
  // Il mapping di permission e menu è quello validato in SQL: mai URL, nomi o id fissi.
  const permissions = await tx.execute<GrantId & Record<string, unknown>>(sql`
    select rp.id_role::text as role, rp.id_permission::text as target
    from public.role_permission rp join public.app_feature f on f.id_permission = rp.id_permission
    where rp.id_tenant = ${tenantId} and f.area_code is not null and f.code in (${list})
    order by rp.id_role, rp.id_permission ${shouldLockGrants ? sql`for update of rp` : sql``}`)
  const menus = await tx.execute<GrantId & Record<string, unknown>>(sql`
    select rf.id_role::text as role, rf.id_menu_entry::text as target
    from public.role_functionality rf
    join public.menu_entry m on m.id_tenant = rf.id_tenant and m.id_menu_entry = rf.id_menu_entry
    join public.app_feature f on f.code = m.feature_key
    where rf.id_tenant = ${tenantId} and f.area_code is not null and m.feature_key in (${list})
    order by rf.id_role, rf.id_menu_entry ${shouldLockGrants ? sql`for update of rf` : sql``}`)
  const fingerprint = createHash('sha256').update(JSON.stringify({ tenantId, keys, permissions, menus })).digest('hex')
  return {
    permissions: [...permissions], menus: [...menus],
    preview: {
      revision: policy.revision, keys,
      roleCount: new Set([...permissions, ...menus].map(grant => grant.role)).size,
      permissionGrantCount: permissions.length, menuGrantCount: menus.length, fingerprint,
    },
  }
}

/** L'anteprima resta disponibile anche quando il blocco di rilascio chiude le scritture. */
export async function previewTenantGrantPurge(tenantId: number, keys: FeatureKey[]): Promise<PurgePreview> {
  await requirePlatformAdmin()
  const id = tenantIdArgSchema.parse(tenantId)
  const parsedKeys = purgeKeysSchema.parse(keys)
  const tenantKey = await existingTenantId(id)
  return withPlatform(async tx => {
    const policy = await selectTenantPolicy(tx)
    if (!canPurge(policy, parsedKeys)) throw new Error('invalid_purge_selection')
    return (await selectPurge(tx, tenantKey, policy, parsedKeys)).preview
  }, tenantKey)
}

/** Ricalcola sotto il blocco comune: i conteggi da soli non identificano le assegnazioni. */
export async function purgeTenantGrants(tenantId: number, preview: PurgePreview): Promise<PolicyActionResult> {
  const actor = await requirePlatformAdmin()
  if (process.env.CONSTRUCT_PLATFORM_POLICY_WRITES !== '1') return { ok: false, reason: 'disabled' }
  const parsedId = tenantIdArgSchema.safeParse(tenantId)
  const parsed = purgePreviewSchema.safeParse(preview)
  if (!parsedId.success || !parsed.success) return { ok: false, reason: 'invalid' }
  const value = parsed.data
  const tenantKey = await existingTenantId(parsedId.data)
  return withPlatform<PolicyActionResult>(async tx => {
    const policy = await lockedPolicy(tx, tenantKey)
    if (policy.revision !== value.revision) return { ok: false, reason: 'conflict' }
    if (!canPurge(policy, value.keys)) return { ok: false, reason: 'invalid' }
    // Le revoche SQL possono saltare il lock della policy: proteggere le identità fino a DELETE e audit.
    const current = await selectPurge(tx, tenantKey, policy, value.keys, true)
    if (current.preview.fingerprint !== value.fingerprint || current.preview.roleCount !== value.roleCount
      || current.preview.permissionGrantCount !== value.permissionGrantCount || current.preview.menuGrantCount !== value.menuGrantCount) {
      return { ok: false, reason: 'conflict' }
    }
    for (const grant of current.permissions) await tx.execute(sql`delete from public.role_permission
      where id_tenant = ${tenantKey} and id_role = ${grant.role}::bigint and id_permission = ${grant.target}::bigint`)
    for (const grant of current.menus) await tx.execute(sql`delete from public.role_functionality
      where id_tenant = ${tenantKey} and id_role = ${grant.role}::bigint and id_menu_entry = ${grant.target}::bigint`)
    const revision = policy.revision + 1
    await tx.update(tenantPlatformPolicy).set({ revision }).where(eq(tenantPlatformPolicy.idTenant, tenantKey))
    await recordBoth(tx, actor, tenantKey, {
      operation: 'tenant.grants.purge', objectType: 'tenant_platform_policy', objectId: tenantKey,
      details: { ...current.preview, revision: { from: policy.revision, to: revision }, removed: { permissions: current.permissions, menus: current.menus } },
    })
    return { ok: true, revision }
  }, tenantKey)
}
