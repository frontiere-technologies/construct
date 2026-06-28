import { auth } from '@/lib/auth'

export async function requireAdmin(): Promise<{ userId: string; roleIds: number[] }> {
  const session = await auth()
  const user = session?.user as { id?: string; roleIds?: number[]; isAdmin?: boolean } | undefined
  if (!user?.isAdmin) throw new Error('Unauthorized')
  return { userId: user.id ?? '', roleIds: user.roleIds ?? [] }
}
