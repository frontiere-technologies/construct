import { eq, sql } from 'drizzle-orm'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
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
 * Registrazione (MT4-DEC-9, MT4-DEC-10): dà alla persona l'appartenenza al tenant indicato, quello
 * dell'indirizzo della richiesta che la rotta ha già risolto (lo stesso il cui indirizzo va nel link
 * dell'email), solo se quel tenant accetta registrazioni autonome, è attivo e la persona non
 * appartiene a nessun tenant. Ritorna lo stato dell'appartenenza dopo la chiamata, oppure `null`
 * quando non ne esiste una; non riattiva mai un'appartenenza disattivata. La logica vive in
 * `public.join_by_registration` (0054).
 *
 * Se l'appartenenza nasce adesso, la voce `member.join` del registro del tenant si scrive nella
 * stessa transazione (MT5-DEC-15); chi si registra è la persona che agisce (veste `person`, email
 * dall'account). Una persona già membro non cambia niente e non lascia voce: per saperlo la
 * funzione SQL non basta (risponde `active` in entrambi i casi), quindi si legge prima l'appartenenza.
 *
 * Limite noto: quella lettura non prende un lucchetto. Due registrazioni simultanee della stessa
 * persona potrebbero leggere entrambe «nessuna appartenenza» e scrivere entrambe `member.join`:
 * al peggio una voce doppia, mai una voce persa (l'appartenenza nasce una volta sola, `on conflict
 * do nothing`, e almeno una delle due transazioni la vede nascere).
 */
export async function joinTenantByRegistration(userId: string, tenantId: TenantId): Promise<MembershipStatus | null> {
  return withTenant(tenantId, async tx => {
    const [existing] = await tx.select({ status: tenantMembership.status }).from(tenantMembership)
      .where(eq(tenantMembership.userId, userId)).limit(1)
    const [row] = await tx.execute<{ status: string | null }>(
      sql`select public.join_by_registration(${userId}::uuid) as status`)
    const status = isMembershipStatus(row?.status) ? row.status : null
    if (!existing && status === MEMBERSHIP_ACTIVE) {
      await recordTenantAudit(tx, { userId, email: null, kind: 'person' }, {
        operation: 'member.join', objectType: 'user', objectId: userId,
      })
    }
    return status
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
