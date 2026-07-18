import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userRole } from '@/lib/db/schema'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

/**
 * Ensures the user has the Registered-user role, then returns all role ids.
 * Called from the NextAuth jwt callback once the user id is known.
 */
export async function resolveUserRoleIds(userId: string): Promise<number[]> {
  await db.insert(userRole).values({ userId, idRole: ROLE_REGISTERED }).onConflictDoNothing()
  try {
    const rows = await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
    return rows.map(r => r.idRole)
  } catch (err) {
    throw new Error(`Failed to resolve roles: ${err instanceof Error ? err.message : String(err)}`)
  }
}
