import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userRole, users } from '@/lib/db/schema'
import { evaluateAuthorization } from '@/lib/auth-policy'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

export async function resolveUserAuthorization(
  userId: string,
  ensureRegisteredRole = false,
): Promise<{ accountActive: boolean; roleIds: number[]; isAdmin: boolean }> {
  const [user] = await db
    .select({ idUserStatus: users.idUserStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) return evaluateAuthorization(null, [])
  if (ensureRegisteredRole && user.idUserStatus === 2) {
    await db.insert(userRole).values({ userId, idRole: ROLE_REGISTERED }).onConflictDoNothing()
  }

  const rows = await db
    .select({ idRole: userRole.idRole })
    .from(userRole)
    .where(eq(userRole.userId, userId))
  return evaluateAuthorization(user.idUserStatus, rows.map(row => row.idRole))
}
