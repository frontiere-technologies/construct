'use client'

import { useSession, signOut as nextAuthSignOut } from 'next-auth/react'

interface AuthUser {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  isAdmin: boolean
}

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthContextType {
  const { data: session, status } = useSession()

  const user: AuthUser | null = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        isAdmin: session.user.isAdmin,
      }
    : null

  return {
    user,
    loading: status === 'loading',
    signOut: () => nextAuthSignOut({ callbackUrl: '/login' }),
  }
}
