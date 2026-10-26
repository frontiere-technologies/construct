import { sql } from 'drizzle-orm'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { userRole } from '@/lib/db/schema'
import { evaluateAuthorization } from '@/lib/auth-policy'
import { ensureDefaultMembership, isMembershipStatus, type MembershipStatus } from '@/lib/tenancy/membership'
import { DEFAULT_TENANT_SLUG, type TenantId } from '@/lib/tenancy/tenant-id'
import type { SystemRoleIds } from '@/lib/tenancy/system-roles'

type UserAuthorization = { accountActive: boolean; roleIds: number[]; isAdmin: boolean }

export interface AuthorizationSnapshot {
  userExists: boolean
  status: number | null
  membershipStatus: MembershipStatus | null
  roleIds: number[]
  system: SystemRoleIds
  permissionCodes: string[]
  /**
   * Solo con `host`: il tenant della transazione risponde sull'indirizzo, è `active` e non è il
   * modello (MT4-DEC-7). `null` quando non è stato chiesto.
   */
  tenantEligible: boolean | null
  /** Solo con `host`: il nome del tenant della transazione, per la sessione. */
  tenantName: string | null
  /**
   * Il tenant della transazione è il predefinito: solo lì si scrivono i cataloghi globali fino al
   * pezzo 5 (`GLOBAL_CATALOG_WRITE_CODES` in `actor.ts`).
   */
  tenantIsDefault: boolean
}

type SnapshotRow = {
  registered: string | null
  tenant_admin: string | null
  user_exists: boolean
  status: string | null
  membership_status: string | null
  role_ids: string[] | null
  permission_codes: string[] | null
  tenant_eligible: boolean | null
  tenant_name: string | null
  tenant_is_default: boolean | null
}

/**
 * Tutto ciò che serve per decidere chi è l'utente nel tenant della transazione, in una sola
 * istruzione (specifica 2026-10-15, §2.2): i due ruoli di sistema, lo stato (globale),
 * l'appartenenza al tenant e i ruoli nel tenant, più, se richiesti, i codici dei permessi di quei
 * ruoli. La RLS limita appartenenza, ruoli e concessioni al tenant corrente. Le colonne bigint arrivano da postgres.js come stringhe.
 *
 * Con `host` (anche `null`, l'indirizzo principale) la stessa istruzione dice se il tenant della
 * transazione è ancora idoneo su quell'indirizzo (pezzo 4, §3.1, MT4-DEC-7): è la rivalidazione del
 * tenant del token a ogni richiesta, senza un viaggio in più. `host_tenant_ids` scarta già i tenant
 * non attivi e il modello, e normalizza l'indirizzo come `normalizeHost`.
 */
export async function selectAuthorizationSnapshot(
  tx: TenantTx,
  userId: string,
  options: { permissionCodes?: boolean; host?: string | null } = {},
): Promise<AuthorizationSnapshot> {
  // I codici dei permessi concessi dai ruoli dell'utente; un permesso deprecato non conta anche se
  // la concessione esiste ancora.
  const codes = options.permissionCodes
    ? sql`coalesce((
        select array_agg(distinct p.code order by p.code)
        from public.role_permission rp
        join public.permission p on p.id_permission = rp.id_permission
        where rp.id_role in (select ur.id_role from public.user_role ur where ur.user_id = ${userId})
          and p.deprecated_at is null and p.code is not null
      ), '{}')`
    : sql`'{}'::text[]`
  const checkHost = options.host !== undefined
  const tenantEligible = checkHost
    ? sql`(app_private.current_tenant_id() in (select h.id from public.host_tenant_ids(${options.host}::text) as h(id)))`
    : sql`null::boolean`
  const tenantName = checkHost
    ? sql`(select t.name from public.tenant t where t.id = app_private.current_tenant_id())`
    : sql`null::text`
  const [row] = await tx.execute<SnapshotRow>(sql`
    select
      (select max(r.id_role) from public.role r where r.system_key = 'REGISTERED')::text as registered,
      (select max(r.id_role) from public.role r where r.system_key = 'TENANT_ADMIN')::text as tenant_admin,
      exists (select 1 from public.users u where u.id = ${userId}) as user_exists,
      (select u.id_user_status from public.users u where u.id = ${userId})::text as status,
      (select m.status from public.tenant_membership m where m.user_id = ${userId}) as membership_status,
      coalesce((select array_agg(ur.id_role order by ur.id_role)::text[] from public.user_role ur where ur.user_id = ${userId}), '{}') as role_ids,
      ${codes} as permission_codes,
      ${tenantEligible} as tenant_eligible,
      ${tenantName} as tenant_name,
      exists (select 1 from public.tenant t where t.id = app_private.current_tenant_id() and t.slug = ${DEFAULT_TENANT_SLUG}) as tenant_is_default
  `)
  if (row.registered === null || row.tenant_admin === null) throw new Error('system roles missing')
  return {
    userExists: row.user_exists,
    status: row.status === null ? null : Number(row.status),
    // La RLS lascia vedere solo l'appartenenza al tenant corrente.
    membershipStatus: isMembershipStatus(row.membership_status) ? row.membership_status : null,
    roleIds: (row.role_ids ?? []).map(Number),
    system: { registered: Number(row.registered), tenantAdmin: Number(row.tenant_admin) },
    permissionCodes: row.permission_codes ?? [],
    tenantEligible: row.tenant_eligible,
    tenantName: row.tenant_name,
    tenantIsDefault: row.tenant_is_default === true,
  }
}

export async function selectUserAuthorization(
  tx: TenantTx,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  // Solo all'accesso (callback jwt con ensureRegisteredRole): prima l'appartenenza al tenant
  // predefinito (MT2-DEC-12), perché il ruolo base esiste solo per chi è membro.
  if (ensureRegisteredRole) await ensureDefaultMembership(tx, userId)
  const snapshot = await selectAuthorizationSnapshot(tx, userId)
  if (!snapshot.userExists) return evaluateAuthorization(null, null, [], snapshot.system.tenantAdmin)
  let roleIds = snapshot.roleIds
  // Il ruolo base si aggiunge solo a chi può agire: account e appartenenza attivi.
  const canAct = evaluateAuthorization(snapshot.status, snapshot.membershipStatus, roleIds, snapshot.system.tenantAdmin).accountActive
  if (ensureRegisteredRole && canAct && !roleIds.includes(snapshot.system.registered)) {
    await tx.insert(userRole).values({ userId, idRole: snapshot.system.registered }).onConflictDoNothing()
    roleIds = [...roleIds, snapshot.system.registered].sort((a, b) => a - b)
  }
  return evaluateAuthorization(snapshot.status, snapshot.membershipStatus, roleIds, snapshot.system.tenantAdmin)
}

export async function resolveUserAuthorization(
  tenantId: TenantId,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  return withTenant(tenantId, tx => selectUserAuthorization(tx, userId, ensureRegisteredRole))
}

/** L'autorizzazione nel tenant del token più il controllo del tenant sull'indirizzo della richiesta. */
export type TenantAuthorization = UserAuthorization & { tenantEligible: boolean; tenantName: string | null }

/**
 * La rivalidazione a ogni richiesta del callback `jwt` (pezzo 4, §3.1, MT4-DEC-7): in un'istruzione
 * sola account, appartenenza e ruoli nel tenant del token e idoneità del tenant sull'indirizzo della
 * richiesta. Stessi viaggi della lettura di prima: il controllo del tenant non ne aggiunge.
 */
export async function resolveTenantAuthorization(
  tenantId: TenantId,
  userId: string,
  host: string | null,
): Promise<TenantAuthorization> {
  return withTenant(tenantId, async tx => {
    const snapshot = await selectAuthorizationSnapshot(tx, userId, { host })
    const authorization = snapshot.userExists
      ? evaluateAuthorization(snapshot.status, snapshot.membershipStatus, snapshot.roleIds, snapshot.system.tenantAdmin)
      : evaluateAuthorization(null, null, [], snapshot.system.tenantAdmin)
    return { ...authorization, tenantEligible: snapshot.tenantEligible === true, tenantName: snapshot.tenantName }
  })
}
