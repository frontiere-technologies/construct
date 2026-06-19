import NextAuth, { CredentialsSignin } from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase-server'

// In-memory cache for allowed domains (60s TTL)
let domainCache: { domains: string[]; expiresAt: number } | null = null

async function getAllowedDomains(): Promise<string[]> {
  const now = Date.now()
  if (domainCache && domainCache.expiresAt > now) return domainCache.domains
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('allowed_domains')
    .select('domain')
    .eq('active', true)
  const domains = (data ?? []).map((r: { domain: string }) => r.domain)
  domainCache = { domains, expiresAt: now + 60_000 }
  return domains
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

        const supabase = createAdminClient()
        const { data: user } = await supabase
          .from('users')
          .select('id, email, name, role, password_hash')
          .eq('email', credentials.email)
          .single()

        if (!user) {
          // Prevent timing-based user enumeration
          await bcrypt.compare('dummy', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW')
          return null
        }

        if (!user.password_hash) {
          const err = new CredentialsSignin('Password not set')
          err.code = 'PasswordNotSet'
          throw err
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) return null

        return { id: user.id, email: user.email, name: user.name ?? user.email }
      },
    })
  )

  // Test-only credentials provider — gated by env var, never enabled in production
  if (process.env.AUTH_TEST_CREDENTIALS === 'true') {
    providers.push(
      Credentials({
        id: 'test-credentials',
        name: 'Test Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
        },
        async authorize(credentials) {
          if (!credentials?.email || typeof credentials.email !== 'string') return null
          const supabase = createAdminClient()
          await supabase
            .from('users')
            .upsert(
              { email: credentials.email, role: 'user' },
              { onConflict: 'email', ignoreDuplicates: true }
            )
          const { data } = await supabase
            .from('users')
            .select('id, email, role, name')
            .eq('email', credentials.email)
            .single()
          if (!data) return null
          return { id: data.id, email: data.email, name: data.name ?? data.email }
        },
      })
    )
  }

  return providers
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: buildProviders(),
  session: { strategy: 'jwt' as const },
  callbacks: {
    async signIn({ account, profile }) {
      // Domain restriction for Google OAuth
      if (account?.provider === 'google') {
        const email = profile?.email ?? ''
        const domain = email.split('@')[1] ?? ''
        const allowed = await getAllowedDomains()
        if (!allowed.includes(domain)) return false
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account && user) {
        try {
          const supabase = createAdminClient()
          const { data } = await supabase
            .from('users')
            .upsert(
              {
                email: user.email,
                name: user.name,
                ...(user.image ? { avatar: user.image } : {}),
              },
              { onConflict: 'email', ignoreDuplicates: false }
            )
            .select('id, role')
            .single()
          token.userId = (data?.id as string) ?? ''
          token.role = (data?.role as string) ?? 'user'
        } catch (err) {
          console.error('[auth] Failed to provision user in Supabase:', err)
          throw err
        }
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.role = token.role as string
      return session
    },
  },
  pages: { signIn: '/login' },
})
