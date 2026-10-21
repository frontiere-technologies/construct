import { eq, sql } from 'drizzle-orm'
import { tenantMembership } from '@/lib/db/schema'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { resolveRequestTenant } from '@/lib/tenancy/request-tenant'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/** Lo stato di un'appartenenza a un tenant (specifica 2026-10-20, §2.1). */
export type MembershipStatus = 'active' | 'deactivated'

export const MEMBERSHIP_ACTIVE: MembershipStatus = 'active'
export const MEMBERSHIP_DEACTIVATED: MembershipStatus = 'deactivated'

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return value === MEMBERSHIP_ACTIVE || value === MEMBERSHIP_DEACTIVATED
}

/**
 * Primo accesso (MT2-DEC-12): dà alla persona l'appartenenza al tenant predefinito, se il tenant
 * della transazione è quello e la persona non appartiene a un altro tenant. Ritorna lo stato
 * dell'appartenenza dopo la chiamata, oppure `null` quando non ne esiste una. Non riattiva mai
 * un'appartenenza disattivata. La logica vive nella funzione SQL, in un solo viaggio.
 */
export async function ensureDefaultMembership(tx: TenantTx, userId: string): Promise<MembershipStatus | null> {
  const [row] = await tx.execute<{ status: string | null }>(
    sql`select public.ensure_default_membership(${userId}::uuid) as status`)
  return isMembershipStatus(row?.status) ? row.status : null
}

/**
 * Vero solo se nel tenant indicato la persona ha una riga di appartenenza ed è disattivata
 * (§3.1). Senza riga è falso: la riga la crea il primo accesso (`ensureDefaultMembership`).
 */
export async function isMembershipDeactivated(tenantId: TenantId, userId: string): Promise<boolean> {
  const [row] = await withTenant(tenantId, tx => tx
    .select({ status: tenantMembership.status })
    .from(tenantMembership)
    .where(eq(tenantMembership.userId, userId))
    .limit(1))
  return row?.status === MEMBERSHIP_DEACTIVATED
}

/**
 * Registrazione: dà alla persona l'appartenenza al tenant predefinito, con le stesse regole del
 * primo accesso (mai un'appartenenza disattivata riattivata, mai chi appartiene a un altro tenant).
 */
export async function joinDefaultTenant(userId: string): Promise<MembershipStatus | null> {
  return withTenant(await resolveRequestTenant(), tx => ensureDefaultMembership(tx, userId))
}
