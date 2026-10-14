import { eq } from 'drizzle-orm'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { userRole, users } from '@/lib/db/schema'
import { evaluateAuthorization } from '@/lib/auth-policy'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

type UserAuthorization = { accountActive: boolean; roleIds: number[]; isAdmin: boolean }

export async function selectUserAuthorization(
  tx: TenantTx,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  const [user] = await tx
    .select({ idUserStatus: users.idUserStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) return evaluateAuthorization(null, [])
  if (ensureRegisteredRole && user.idUserStatus === 2) {
    await tx.insert(userRole).values({ userId, idRole: ROLE_REGISTERED }).onConflictDoNothing()
  }

  const rows = await tx
    .select({ idRole: userRole.idRole })
    .from(userRole)
    .where(eq(userRole.userId, userId))
  return evaluateAuthorization(user.idUserStatus, rows.map(row => row.idRole))
}

export async function resolveUserAuthorization(
  tenantId: TenantId,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  return withTenant(tenantId, tx => selectUserAuthorization(tx, userId, ensureRegisteredRole))
}
