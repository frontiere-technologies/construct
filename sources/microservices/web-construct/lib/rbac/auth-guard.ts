import { auth } from '@/lib/auth'
import { resolveUserAuthorization } from './auth-roles'

export async function requireAdmin(): Promise<{ userId: string; roleIds: number[] }> {
  const session = await auth()
  const user = session?.user as { id?: string; roleIds?: number[]; isAdmin?: boolean } | undefined
  if (!user?.id) throw new Error('Unauthorized')
  const authorization = await resolveUserAuthorization(user.id)
  if (!authorization.accountActive || !authorization.isAdmin) throw new Error('Unauthorized')
  return { userId: user.id, roleIds: authorization.roleIds }
}
