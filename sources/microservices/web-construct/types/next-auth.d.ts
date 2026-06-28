import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      roleIds: number[]
      isAdmin: boolean
      provider: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    roleIds: number[]
    isAdmin: boolean
    provider: string
  }
}
