import { eq, sql } from 'drizzle-orm'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { resolveHostTenant } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
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
 * della transazione è quello, se accetta registrazioni autonome (MT4-DEC-10, 0054) e la persona
 * non appartiene a un altro tenant. Ritorna lo stato dell'appartenenza dopo la chiamata, oppure
 * `null` quando non ne esiste una. Non riattiva mai un'appartenenza disattivata. La logica vive
 * nella funzione SQL, in un solo viaggio.
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
 * L'email di una persona che è membro del tenant indicato, in qualunque stato (anche disattivato),
 * oppure `null`. Chi è membro solo di altri tenant risponde come un id che non esiste: la RLS mostra
 * soltanto le appartenenze del tenant della transazione, e chi chiama non può distinguere i due casi.
 */
export async function tenantMemberEmail(tenantId: TenantId, userId: string): Promise<string | null> {
  const [row] = await withTenant(tenantId, tx => tx
    .select({ email: users.email })
    .from(tenantMembership)
    .innerJoin(users, eq(users.id, tenantMembership.userId))
    .where(eq(tenantMembership.userId, userId))
    .limit(1))
  return row?.email ?? null
}

/**
 * Registrazione (MT4-DEC-9, MT4-DEC-10): dà alla persona l'appartenenza al tenant dell'indirizzo
 * della richiesta (il predefinito sull'indirizzo principale o su uno sconosciuto), solo se quel
 * tenant accetta registrazioni autonome, è attivo e la persona non appartiene a nessun tenant. Chi
 * si registra non ha una sessione: il tenant viene solo dall'indirizzo confrontato con il registro.
 * Ritorna lo stato dell'appartenenza dopo la chiamata, oppure `null` quando non ne esiste una; non
 * riattiva mai un'appartenenza disattivata. La logica vive in `public.join_by_registration` (0054).
 */
export async function joinTenantByRegistration(userId: string): Promise<MembershipStatus | null> {
  return withTenant(await resolveHostTenant(await readRequestHost()), async tx => {
    const [row] = await tx.execute<{ status: string | null }>(
      sql`select public.join_by_registration(${userId}::uuid) as status`)
    return isMembershipStatus(row?.status) ? row.status : null
  })
}

/**
 * Aggiunta per email (MT2-DEC-5): dà alla persona l'appartenenza attiva al tenant della
 * transazione. Se la riga esiste già, qualunque ne sia lo stato, non cambia niente e ritorna
 * `false`: un'appartenenza disattivata non si riattiva da qui (solo "Attiva" della pagina Utenti
 * lo fa) e i ruoli già assegnati non si toccano. Solo se crea la riga aggiunge il ruolo base
 * `REGISTERED` del tenant e ritorna `true`.
 */
export async function addTenantMember(tx: TenantTx, userId: string): Promise<boolean> {
  const created = await tx.insert(tenantMembership)
    .values({ userId, status: MEMBERSHIP_ACTIVE })
    .onConflictDoNothing()
    .returning({ userId: tenantMembership.userId })
  if (created.length === 0) return false
  const system = await getSystemRoleIds(tx)
  await tx.insert(userRole).values({ userId, idRole: system.registered }).onConflictDoNothing()
  return true
}
