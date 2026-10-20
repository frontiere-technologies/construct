import { sql } from 'drizzle-orm'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { userRole } from '@/lib/db/schema'
import { ACTIVE_USER_STATUS, evaluateAuthorization } from '@/lib/auth-policy'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { SystemRoleIds } from '@/lib/tenancy/system-roles'

type UserAuthorization = { accountActive: boolean; roleIds: number[]; isAdmin: boolean }

export interface AuthorizationSnapshot {
  userExists: boolean
  status: number | null
  roleIds: number[]
  system: SystemRoleIds
  permissionCodes: string[]
}

type SnapshotRow = {
  registered: string | null
  tenant_admin: string | null
  user_exists: boolean
  status: string | null
  role_ids: string[] | null
  permission_codes: string[] | null
}

/**
 * Tutto ciò che serve per decidere chi è l'utente nel tenant della transazione, in una sola
 * istruzione (specifica 2026-10-15, §2.2): i due ruoli di sistema, lo stato (globale) e i ruoli nel
 * tenant, più, se richiesti, i codici dei permessi di quei ruoli. La RLS limita ruoli e
 * concessioni al tenant corrente. Le colonne bigint arrivano da postgres.js come stringhe.
 */
export async function selectAuthorizationSnapshot(
  tx: TenantTx,
  userId: string,
  options: { permissionCodes?: boolean } = {},
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
  const [row] = await tx.execute<SnapshotRow>(sql`
    select
      (select max(r.id_role) from public.role r where r.system_key = 'REGISTERED')::text as registered,
      (select max(r.id_role) from public.role r where r.system_key = 'TENANT_ADMIN')::text as tenant_admin,
      exists (select 1 from public.users u where u.id = ${userId}) as user_exists,
      (select u.id_user_status from public.users u where u.id = ${userId})::text as status,
      coalesce((select array_agg(ur.id_role order by ur.id_role)::text[] from public.user_role ur where ur.user_id = ${userId}), '{}') as role_ids,
      ${codes} as permission_codes
  `)
  if (row.registered === null || row.tenant_admin === null) throw new Error('system roles missing')
  return {
    userExists: row.user_exists,
    status: row.status === null ? null : Number(row.status),
    roleIds: (row.role_ids ?? []).map(Number),
    system: { registered: Number(row.registered), tenantAdmin: Number(row.tenant_admin) },
    permissionCodes: row.permission_codes ?? [],
  }
}

export async function selectUserAuthorization(
  tx: TenantTx,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  const snapshot = await selectAuthorizationSnapshot(tx, userId)
  if (!snapshot.userExists) return evaluateAuthorization(null, [], snapshot.system.tenantAdmin)
  let roleIds = snapshot.roleIds
  // Solo all'accesso (callback jwt con ensureRegisteredRole): il ruolo base si aggiunge qui.
  if (ensureRegisteredRole && snapshot.status === ACTIVE_USER_STATUS && !roleIds.includes(snapshot.system.registered)) {
    await tx.insert(userRole).values({ userId, idRole: snapshot.system.registered }).onConflictDoNothing()
    roleIds = [...roleIds, snapshot.system.registered].sort((a, b) => a - b)
  }
  return evaluateAuthorization(snapshot.status, roleIds, snapshot.system.tenantAdmin)
}

export async function resolveUserAuthorization(
  tenantId: TenantId,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  return withTenant(tenantId, tx => selectUserAuthorization(tx, userId, ensureRegisteredRole))
}
