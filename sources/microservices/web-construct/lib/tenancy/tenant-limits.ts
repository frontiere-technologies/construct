import { sql } from 'drizzle-orm'
import type { PlatformAuditTx } from '@/lib/audit/audit-types'
import type { TenantTx } from '@/lib/db/tenant-db'

export interface TenantUsage {
  members: number
  roles: number
  menuEntries: number
}

/** All memberships, both system roles and categories consume their resource. */
export async function selectTenantUsage(tx: TenantTx | PlatformAuditTx): Promise<TenantUsage> {
  const [usage] = await tx.execute<{ members: number; roles: number; menuEntries: number }>(sql`
    select (select count(*)::int from public.tenant_membership) as members,
      (select count(*)::int from public.role) as roles,
      (select count(*)::int from public.menu_entry) as "menuEntries"`)
  return { members: usage.members, roles: usage.roles, menuEntries: usage.menuEntries }
}

/** PostgreSQL uses zero for an unlimited connection; null inherits that limit. */
export function effectiveQueryTimeoutMs(connectionLimitMs: number, tenantLimitMs: number | null): number {
  if (tenantLimitMs === null) return connectionLimitMs
  return connectionLimitMs === 0 ? tenantLimitMs : Math.min(connectionLimitMs, tenantLimitMs)
}
