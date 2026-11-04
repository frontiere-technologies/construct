'use server'

import { sql } from 'drizzle-orm'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'
import { existingTenantId } from '@/lib/tenancy/platform-tenant'
import { withPlatform } from './db'
import { slugSchema, tenantIdArgSchema } from './tenant-action-schemas'

type DeleteTenantResult = { ok: true } | { ok: false; reason: 'invalid' | 'protected' | 'not_archived' | 'changed' }

export async function deleteTenantPermanently(tenantId: number, confirmationSlug: string): Promise<DeleteTenantResult> {
  const actor = await requirePlatformAdmin()
  if (!tenantIdArgSchema.safeParse(tenantId).success || !slugSchema.safeParse(confirmationSlug).success) {
    return { ok: false, reason: 'invalid' }
  }

  try {
    const id = await existingTenantId(tenantId)
    await withPlatform(tx => tx.execute(sql`
      select app_private.erase_tenant(${id}::bigint, ${confirmationSlug}::text, ${actor.userId}::uuid)
    `), id)
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'tenant_not_found') return { ok: false, reason: 'changed' }
    const cause = error instanceof Error ? error.cause : undefined
    if (cause instanceof Error && 'code' in cause && cause.code === 'P0001') {
      switch (cause.message) {
        case 'tenant_erase_changed': return { ok: false, reason: 'changed' }
        case 'tenant_erase_protected': return { ok: false, reason: 'protected' }
        case 'tenant_erase_not_archived': return { ok: false, reason: 'not_archived' }
      }
    }
    throw error
  }
}
