import NextAuth from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { authConfig, mergeAuthCallbacks } from '@/lib/auth.config'
import { resolveUserAuthorization } from '@/lib/rbac/auth-roles'
import {
  assertSafeAuthConfiguration,
  isActiveAccount,
  isTestCredentialsEnabled,
  verifyCredentialCandidate,
} from '@/lib/auth-policy'
import { AuthRateLimitExceeded, enforceAuthRateLimit } from '@/lib/auth-rate-limit'

const log = createLogger('auth')
assertSafeAuthConfiguration(process.env)

// In-memory cache for allowed domains (60s TTL)
let domainCache: { domains: string[]; expiresAt: number } | null = null

async function getAllowedDomains(): Promise<string[]> {
  const now = Date.now()
  if (domainCache && domainCache.expiresAt > now) return domainCache.domains
  try {
    const rows = await db.select({ domain: allowedDomains.domain }).from(allowedDomains).where(eq(allowedDomains.active, true))
    const domains = rows.map(r => r.domain)
    domainCache = { domains, expiresAt: now + 60_000 }
    return domains
  } catch (err) {
    log.error({ err }, 'failed to retrieve allowed domains')
    return domainCache?.domains ?? []
  }
}

function buildProviders() {
  const providers = []

  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
          ? `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0/`
          : undefined,
      })
    )
  }

  if (process.env.AUTH_GOOGLE_ID) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      })
    )
  }

  if (process.env.AUTH_KEYCLOAK_ID) {
    providers.push(
      Keycloak({
        clientId: process.env.AUTH_KEYCLOAK_ID,
        clientSecret: process.env.AUTH_KEYCLOAK_SECRET!,
        issuer: process.env.AUTH_KEYCLOAK_ISSUER!,
      })
    )
  }

  // Production credentials provider — email + bcrypt password
  providers.push(
    Credentials({
      id: 'credentials',
      name: 'Email e password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (
          !credentials?.email ||
          !credentials?.password ||
          typeof credentials.email !== 'string' ||
          typeof credentials.password !== 'string'
        ) return null

        const normalizedEmail = credentials.email.toLowerCase().trim()
        try {
          await enforceAuthRateLimit({ request, scope: 'credentials-login', account: normalizedEmail })
        } catch (err) {
          if (err instanceof AuthRateLimitExceeded) {
            log.warn({ reason: 'rate-limit' }, 'credentials rejected')
            return null
          }
          throw err
        }

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            passwordHash: users.passwordHash,
            idUserStatus: users.idUserStatus,
          })
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1)

        const valid = await verifyCredentialCandidate(user, credentials.password, bcrypt.compare)
        if (!valid) {
          const reason = !user ? 'unknown' : !user.passwordHash ? 'passwordless' : !isActiveAccount(user.idUserStatus) ? 'inactive' : 'password'
          log.warn({ reason }, 'credentials rejected')
          return null
        }

        await db.update(users).set({ authProvider: 'credentials' }).where(eq(users.id, user.id))

        return { id: user.id, email: user.email, name: user.name ?? user.email }
      },
    })
  )

  // Test-only credentials provider — gated by env var, never enabled in production
  if (isTestCredentialsEnabled(process.env)) {
    providers.push(
      Credentials({
        id: 'test',
        name: 'Test Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
        },
        async authorize(credentials) {
          if (!credentials?.email || typeof credentials.email !== 'string') return null
          const normalizedEmail = credentials.email.toLowerCase().trim()
          await db.insert(users).values({ email: normalizedEmail, authProvider: 'test' }).onConflictDoNothing({ target: users.email })
          const [data] = await db
            .select({ id: users.id, email: users.email, name: users.name, idUserStatus: users.idUserStatus })
            .from(users)
            .where(eq(users.email, normalizedEmail))
            .limit(1)
          if (!data || !isActiveAccount(data.idUserStatus)) return null
          return { id: data.id, email: data.email, name: data.name ?? data.email }
        },
      })
    )
  }

  return providers
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: buildProviders(),
  session: { strategy: 'jwt' as const },
  callbacks: mergeAuthCallbacks({
    async signIn({ account, profile }) {
      // Domain restriction for all OIDC providers
      const oidcProviders = ['google', 'microsoft-entra-id', 'keycloak']
      if (account?.provider && oidcProviders.includes(account.provider)) {
        const email = (profile?.email ?? '').toLowerCase().trim()
        const domain = email.split('@')[1] ?? ''
        const allowed = await getAllowedDomains()
        if (!allowed.includes(domain)) return false
        const [existing] = await db
          .select({ idUserStatus: users.idUserStatus })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
        if (existing && !isActiveAccount(existing.idUserStatus)) return false
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account) token.provider = account.provider

      if (account && user) {
        let userId: string
        if (account.provider === 'credentials' || account.provider === 'test') {
          userId = user.id as string
        } else {
          try {
            const [data] = await db
              .insert(users)
              .values({
                email: user.email!,
                name: user.name,
                authProvider: account.provider,
                ...(user.image ? { avatar: user.image } : {}),
              })
              .onConflictDoUpdate({
                target: users.email,
                set: {
                  name: user.name,
                  authProvider: account.provider,
                  ...(user.image ? { avatar: user.image } : {}),
                },
              })
              .returning({ id: users.id })
            userId = data?.id ?? ''
          } catch (err) {
            log.error({ err }, 'failed to provision user in Supabase')
            throw err
          }
        }
        token.userId = userId
        if (userId) {
          const authorization = await resolveUserAuthorization(userId, true)
          token.accountActive = authorization.accountActive
          token.roleIds = authorization.roleIds
          token.isAdmin = authorization.isAdmin
        }
      } else if (token.userId) {
        const authorization = await resolveUserAuthorization(token.userId as string)
        token.accountActive = authorization.accountActive
        token.roleIds = authorization.roleIds
        token.isAdmin = authorization.isAdmin
      }
      return token
    },
    async session({ session, token }) {
      const accountActive = Boolean(token.accountActive)
      session.user.id = accountActive ? token.userId as string : ''
      session.user.roleIds = accountActive ? (token.roleIds as number[]) ?? [] : []
      session.user.isAdmin = accountActive && Boolean(token.isAdmin)
      session.user.accountActive = accountActive
      session.user.provider = token.provider as string
      return session
    },
  }),
})
