import NextAuth from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import { createAdminClient } from '@/lib/supabase-server'

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
          // Insert only if the user doesn't exist yet — preserves existing role (e.g. admin)
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
    async jwt({ token, user, account }) {
      if (account && user) {
        // First login: provision user in Supabase
        try {
          const supabase = createAdminClient()
          const { data } = await supabase
            .from('users')
            .upsert(
              {
                email: user.email,
                name: user.name,
                avatar: user.image,
              },
              { onConflict: 'email', ignoreDuplicates: false }
            )
            .select('id, role')
            .single()
          token.userId = (data?.id as string) ?? ''
          token.role = (data?.role as string) ?? 'user'
        } catch (err) {
          console.error('[auth] Failed to provision user in Supabase:', err)
          token.userId = ''
          token.role = 'user'
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
