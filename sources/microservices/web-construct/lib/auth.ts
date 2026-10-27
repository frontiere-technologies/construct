import type { NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { users, allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { authConfig, mergeAuthCallbacks } from '@/lib/auth.config'
import { keepOnRequestHost } from '@/lib/auth-host-redirect'
import { isDedicatedHost } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'
import {
  enterTenant,
  isSignInRefusedOnHost,
  revalidateTokenTenant,
  updateTokenTenant,
  type TokenTenant,
} from '@/lib/tenancy/token-tenant'
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
    const rows = await withGlobal(tx => tx.select({ domain: allowedDomains.domain }).from(allowedDomains).where(eq(allowedDomains.active, true)))
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

        const [user] = await withGlobal(tx => tx
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            passwordHash: users.passwordHash,
            idUserStatus: users.idUserStatus,
          })
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1))

        const valid = await verifyCredentialCandidate(user, credentials.password, bcrypt.compare)
        if (!valid) {
          const reason = !user ? 'unknown' : !user.passwordHash ? 'passwordless' : !isActiveAccount(user.idUserStatus) ? 'inactive' : 'password'
          log.warn({ reason }, 'credentials rejected')
          return null
        }

        // Dopo la verifica della password, così i tempi dei tentativi sbagliati restano uniformi.
        // Il messaggio per chi entra è lo stesso di un account disattivato; cambia solo il motivo nel log.
        // Si rifiuta solo chi sull'indirizzo non ha tenant disponibili e vi ha un'appartenenza
        // disattivata (MT4-DEC-15); chi non ha nessuna appartenenza lì entra e vede il messaggio.
        if (await isSignInRefusedOnHost(user.id, await readRequestHost())) {
          log.warn({ reason: 'membership' }, 'credentials rejected')
          return null
        }

        await withGlobal(tx => tx.update(users).set({ authProvider: 'credentials' }).where(eq(users.id, user.id)))

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
          const [data] = await withGlobal(async tx => {
            await tx.insert(users).values({ email: normalizedEmail, authProvider: 'test' }).onConflictDoNothing({ target: users.email })
            return tx
              .select({ id: users.id, email: users.email, name: users.name, idUserStatus: users.idUserStatus })
              .from(users)
              .where(eq(users.email, normalizedEmail))
              .limit(1)
          })
          if (!data || !isActiveAccount(data.idUserStatus)) return null
          if (await isSignInRefusedOnHost(data.id, await readRequestHost())) {
            log.warn({ reason: 'membership' }, 'test credentials rejected')
            return null
          }
          return { id: data.id, email: data.email, name: data.name ?? data.email }
        },
      })
    )
  }

  return providers
}

const nextAuth = NextAuth({
  ...authConfig,
  // Lo stesso processo risponde su più indirizzi (a.localhost, b.localhost, …). Senza AUTH_URL,
  // trustHost fa usare ad Auth.js l'indirizzo della richiesta; con AUTH_URL impostata (sempre, qui:
  // costruisce i link nelle email) non cambia niente, perché next-auth riscrive comunque l'origine
  // su AUTH_URL. A tenere sull'indirizzo della richiesta i rinvii di Auth.js è
  // lib/auth-host-redirect.ts, negli handler in fondo a questo file (pezzo 4, MT4-RISK-1).
  trustHost: true,
  providers: buildProviders(),
  session: { strategy: 'jwt' as const },
  callbacks: mergeAuthCallbacks({
    async signIn({ account, profile }) {
      // Domain restriction for all OIDC providers
      const oidcProviders = ['google', 'microsoft-entra-id', 'keycloak']
      if (account?.provider && oidcProviders.includes(account.provider)) {
        const host = await readRequestHost()
        // Su un indirizzo dedicato a un tenant si entra con email e password (MT4-DEC-14): l'accesso
        // OIDC resta sull'indirizzo principale. La pagina di accesso lì non mostra il bottone. Questo
        // rifiuto è una difesa in più: next-auth costruisce il redirect_uri su AUTH_URL, quindi il
        // ritorno dal provider di norma arriva sull'indirizzo principale, non su quello dedicato; qui
        // si ferma un ritorno che arriva comunque con un Host dedicato.
        if (await isDedicatedHost(host)) return false
        const email = (profile?.email ?? '').toLowerCase().trim()
        const domain = email.split('@')[1] ?? ''
        const allowed = await getAllowedDomains()
        if (!allowed.includes(domain)) return false
        const [existing] = await withGlobal(tx => tx
          .select({ id: users.id, idUserStatus: users.idUserStatus })
          .from(users)
          .where(eq(users.email, email))
          .limit(1))
        if (existing && !isActiveAccount(existing.idUserStatus)) return false
        if (existing && await isSignInRefusedOnHost(existing.id, host)) return false
      }
      return true
    },
    async jwt({ token, user, account, trigger, session }) {
      if (account) token.provider = account.provider

      if (account && user) {
        let userId: string
        if (account.provider === 'credentials' || account.provider === 'test') {
          userId = user.id as string
        } else {
          try {
            const [data] = await withGlobal(tx => tx
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
              .returning({ id: users.id }))
            userId = data?.id ?? ''
          } catch (err) {
            log.error({ err }, 'failed to provision user in Supabase')
            throw err
          }
        }
        token.userId = userId
        // All'accesso il tenant si sceglie fra quelli disponibili sull'indirizzo (MT4-DEC-4).
        if (userId) applyTokenTenant(token, await enterTenant(userId, await readRequestHost(), { current: null, firstEntry: true }))
      } else if (token.userId) {
        const host = await readRequestHost()
        if (trigger === 'update') {
          // Un aggiornamento (unstable_update da chooseTenant, ma anche POST /api/auth/session del
          // client): del carico vale solo un tenantId fra i tenant disponibili sull'indirizzo,
          // ricontrollato qui; nessun altro campo entra (MT4-DEC-5, MT4-DEC-7).
          applyTokenTenant(token, await updateTokenTenant(token.userId, token, host, session))
        } else {
          // A ogni richiesta il tenant del token si rivalida (MT4-DEC-7): viene solo dal token e
          // dall'indirizzo della richiesta.
          applyTokenTenant(token, await revalidateTokenTenant(token.userId, token, host))
        }
      }
      return token
    },
    async session({ session, token }) {
      const accountActive = Boolean(token.accountActive)
      const ready = token.tenantState === 'ready'
      session.user.id = accountActive ? token.userId as string : ''
      // Ruoli e tenant esistono solo con un tenant scelto; in 'choose' e 'none' la persona resta
      // riconosciuta (id) per arrivare alla scelta o al messaggio (Task 5), senza autorità.
      session.user.roleIds = accountActive && ready ? (token.roleIds as number[]) ?? [] : []
      session.user.accountActive = accountActive
      session.user.provider = token.provider as string
      session.user.tenantState = token.tenantState ?? 'none'
      session.user.tenantId = accountActive && ready ? token.tenantId ?? null : null
      session.user.tenantName = ready ? token.tenantName ?? null : null
      // Solo per il messaggio «spazio sospeso» della pagina senza tenant (MT5-DEC-7).
      session.user.tenantNoneReason = token.tenantState === 'none' && token.tenantNoneReason === 'suspended' ? 'suspended' : null
      // Solo un indizio per il menu e il proxy (MT5-DEC-3): la console decide dal database.
      session.user.isPlatformAdmin = accountActive && token.isPlatformAdmin === true
      return session
    },
  }),
})

export const { auth, signIn, signOut } = nextAuth

/**
 * Aggiorna il token della sessione dal server (trigger 'update' del callback `jwt`). Lo usa
 * `chooseTenant` (lib/tenancy/tenant-actions.ts) dopo il suo controllo; il callback ricontrolla
 * comunque il tenant richiesto. Non passa dagli handler qui sotto: chi lo chiama porta altrove con
 * `redirect` di Next, mai con un rinvio di Auth.js (che punterebbe ad AUTH_URL).
 */
export const { unstable_update } = nextAuth

function applyTokenTenant(token: JWT, tenant: TokenTenant): void {
  token.tenantId = tenant.tenantId
  token.tenantState = tenant.tenantState
  token.tenantHost = tenant.tenantHost
  token.tenantName = tenant.tenantName
  token.accountActive = tenant.accountActive
  token.roleIds = tenant.roleIds
  token.tenantNoneReason = tenant.tenantNoneReason
  token.isPlatformAdmin = tenant.isPlatformAdmin
}

// Con AUTH_URL impostata next-auth costruisce ogni indirizzo di ritorno su AUTH_URL anche con
// trustHost: questi handler li riportano sull'indirizzo della richiesta (lib/auth-host-redirect.ts).
export const handlers = {
  GET: async (request: NextRequest) => keepOnRequestHost(request, await nextAuth.handlers.GET(request)),
  POST: async (request: NextRequest) => keepOnRequestHost(request, await nextAuth.handlers.POST(request)),
}
