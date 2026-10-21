import { sql } from 'drizzle-orm'
import type { TenantTx } from '@/lib/db/tenant-db'

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
