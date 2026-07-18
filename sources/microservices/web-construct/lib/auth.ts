import NextAuth, { CredentialsSignin } from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { authConfig } from '@/lib/auth.config'
import { resolveUserRoleIds, computeIsAdmin } from '@/lib/rbac/auth-roles'

const log = createLogger('auth')

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
      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials?.password ||
          typeof credentials.email !== 'string' ||
          typeof credentials.password !== 'string'
        ) return null

        const [user] = await db
          .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.email, (credentials.email as string).toLowerCase().trim()))
          .limit(1)

        if (!user) {
          // Prevent timing-based user enumeration
          await bcrypt.compare('dummy', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW')
          return null
        }

        if (!user.passwordHash) {
          const err = new CredentialsSignin('Password not set')
          err.code = 'PasswordNotSet'
          throw err
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        await db.update(users).set({ authProvider: 'credentials' }).where(eq(users.id, user.id))

        return { id: user.id, email: user.email, name: user.name ?? user.email }
      },
    })
  )

  // Test-only credentials provider — gated by env var, never enabled in production
  if (process.env.AUTH_TEST_CREDENTIALS === 'true') {
    providers.push(
      Credentials({
        id: 'test',
        name: 'Test Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
        },
        async authorize(credentials) {
          if (!credentials?.email || typeof credentials.email !== 'string') return null
          await db.insert(users).values({ email: credentials.email, authProvider: 'test' }).onConflictDoNothing({ target: users.email })
          const [data] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, credentials.email)).limit(1)
          if (!data) return null
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
  callbacks: {
    async signIn({ account, profile }) {
      // Domain restriction for all OIDC providers
      const oidcProviders = ['google', 'microsoft-entra-id', 'keycloak']
      if (account?.provider && oidcProviders.includes(account.provider)) {
        const email = profile?.email ?? ''
        const domain = email.split('@')[1] ?? ''
        const allowed = await getAllowedDomains()
        if (!allowed.includes(domain)) return false
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
        const roleIds = userId ? await resolveUserRoleIds(userId) : []
        token.roleIds = roleIds
        token.isAdmin = computeIsAdmin(roleIds)
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.roleIds = (token.roleIds as number[]) ?? []
      session.user.isAdmin = Boolean(token.isAdmin)
      session.user.provider = token.provider as string
      return session
    },
  },
})
