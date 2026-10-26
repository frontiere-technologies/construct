import { DefaultSession } from 'next-auth'
import type { TenantState } from '@/lib/tenancy/tenant-selection'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      roleIds: number[]
      accountActive: boolean
      provider: string
      // Il tenant corrente (pezzo 4, §3.1): `tenantId` e `tenantName` solo con `tenantState === 'ready'`.
      tenantState: TenantState
      tenantId: number | null
      tenantName: string | null
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    roleIds: number[]
    accountActive: boolean
    provider: string
    // Facoltativi: un token emesso prima del pezzo 4 non li ha (§5.1).
    tenantId?: number | null
    tenantState?: TenantState
    tenantHost?: string | null
    tenantName?: string | null
  }
}
