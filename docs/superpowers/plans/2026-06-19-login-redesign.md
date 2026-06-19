# Login Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the login page with email+password and Google OAuth (domain-restricted), plus a full "first login / set password" flow via Resend email.

**Architecture:** Auth.js v5 Credentials provider handles email+password with bcrypt; the Google `signIn` callback enforces domain restriction against an `allowed_domains` table in Supabase. A token-based set-password flow lets admins onboard users via a one-time email link.

**Tech Stack:** Next.js 15 (App Router), Auth.js v5 (next-auth), Supabase (PostgreSQL via @supabase/supabase-js service role), Resend (email), bcryptjs, Tailwind CSS v4, Lucide React

## Global Constraints

- All `npm` commands run from `apps/web/`
- All Python/pytest commands use `uv run pytest` — never `python` or `python3` directly
- Tailwind CSS v4 — use inline `style` for custom hex colors (e.g. `#0f2336`); no `tailwind.config.js` extension needed
- Auth.js v5 — import providers from `next-auth/providers/*`, not `next-auth/providers/index`
- Supabase client: always use `createAdminClient()` from `@/lib/supabase-server` for server-side DB access
- No Jest/Vitest — verification is done by running the dev server and using curl; add E2E tests in `tests/e2e/` if the test infrastructure supports it
- Commit after every task using the format: `git commit -m "type: description"`
- Branch: `feature/oidc`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `deploy/db/schema.sql` | Modify | Add `password_hash`, `password_set_tokens`, `allowed_domains` |
| `apps/web/package.json` | Modify (via npm) | Add `resend`, `bcryptjs`, `@types/bcryptjs` |
| `apps/web/.env.template` | Modify | Add `RESEND_API_KEY`, `RESEND_FROM` |
| `apps/web/lib/auth.ts` | Modify | Credentials provider + Google domain check |
| `apps/web/middleware.ts` | Modify | Allow `/set-password` without session |
| `apps/web/components/Login.tsx` | Modify | Full UI redesign |
| `apps/web/app/api/auth/set-password/route.ts` | Create | POST — validate token, save hash, mark used |
| `apps/web/app/api/admin/send-invite/route.ts` | Create | POST — create token, send Resend email |
| `apps/web/app/set-password/page.tsx` | Create | Server component — validate token, render form or error |
| `apps/web/app/set-password/SetPasswordForm.tsx` | Create | Client component — form with validation |

---

### Task 1: DB Schema — Add password_hash, password_set_tokens, allowed_domains

**Files:**
- Modify: `deploy/db/schema.sql`

**Interfaces:**
- Produces: `users.password_hash text` column, `password_set_tokens` table, `allowed_domains` table — consumed by all subsequent tasks

- [ ] **Step 1: Add the three schema changes to `deploy/db/schema.sql`**

  Open `deploy/db/schema.sql`. After the existing `users` table block (around line 55 where the trigger is defined), add:

  ```sql
  -- Migration: add password_hash for email+password login
  alter table users add column if not exists password_hash text;

  -- ============================================================
  -- Tabella: password_set_tokens
  -- One-time tokens for the "set password" invite flow.
  -- ============================================================
  create table if not exists password_set_tokens (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null references users(id) on delete cascade,
    token       text        not null unique,
    expires_at  timestamptz not null,
    used_at     timestamptz,
    created_at  timestamptz default now()
  );

  alter table password_set_tokens disable row level security;

  -- ============================================================
  -- Tabella: allowed_domains
  -- Domains permitted for Google OAuth sign-in.
  -- ============================================================
  create table if not exists allowed_domains (
    id          uuid        primary key default gen_random_uuid(),
    domain      text        not null unique,
    active      boolean     not null default true,
    created_at  timestamptz default now()
  );

  alter table allowed_domains disable row level security;

  -- Seed: frontiere.io as the first allowed domain
  insert into allowed_domains (domain, active)
  values ('frontiere.io', true)
  on conflict (domain) do nothing;
  ```

- [ ] **Step 2: Apply the migration via Supabase MCP**

  Use the `mcp__supabase__apply_migration` tool with:
  - `name`: `add_password_login_tables`
  - `query`: the exact SQL from Step 1 above (all three blocks together)

- [ ] **Step 3: Verify tables exist**

  Use `mcp__supabase__execute_sql` with:
  ```sql
  select column_name from information_schema.columns
  where table_name = 'users' and column_name = 'password_hash';

  select table_name from information_schema.tables
  where table_name in ('password_set_tokens', 'allowed_domains');

  select domain from allowed_domains;
  ```
  Expected output: `password_hash` column present; both tables listed; `frontiere.io` in `allowed_domains`.

- [ ] **Step 4: Commit**

  ```bash
  git add deploy/db/schema.sql
  git commit -m "feat(db): add password_hash, password_set_tokens, allowed_domains tables"
  ```

---

### Task 2: Install Dependencies + Update Env Template

**Files:**
- Modify: `apps/web/package.json` (via npm install)
- Modify: `apps/web/.env.template`

**Interfaces:**
- Produces: `resend` and `bcryptjs` packages available for import in all subsequent tasks

- [ ] **Step 1: Install packages**

  ```bash
  cd apps/web && npm install resend bcryptjs && npm install -D @types/bcryptjs
  ```
  Expected: no errors, `package.json` updated.

- [ ] **Step 2: Update `.env.template`**

  Add at the end of `apps/web/.env.template`:
  ```env
  # Resend email (for invite / set-password flow)
  RESEND_API_KEY=re_...
  RESEND_FROM=noreply@frontiere.io
  ```

- [ ] **Step 3: Verify import works**

  Create a temp file to confirm TypeScript resolves the packages (delete after):
  ```bash
  cd apps/web && node -e "require('bcryptjs'); require('resend'); console.log('OK')"
  ```
  Expected: `OK`

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/package.json apps/web/package-lock.json apps/web/.env.template
  git commit -m "chore: install resend and bcryptjs; update env template"
  ```

---

### Task 3: Auth.js — Credentials Provider + Google Domain Check + Middleware

**Files:**
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/middleware.ts`

**Interfaces:**
- Consumes: `users.password_hash` (Task 1), `allowed_domains` table (Task 1), `bcryptjs` (Task 2)
- Produces: `auth.ts` exports unchanged (`handlers`, `auth`, `signIn`, `signOut`); credentials provider ID `'credentials'`; Google sign-in blocks non-allowed domains

- [ ] **Step 1: Replace `apps/web/lib/auth.ts` with the updated version**

  ```typescript
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
            await bcrypt.compare('dummy', '$2b$10$dummyhashfortimingggggggggggggggggggggg')
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
  ```

- [ ] **Step 2: Update `apps/web/middleware.ts` to allow `/set-password` without session**

  Change the unauthenticated redirect condition from:
  ```typescript
  if (!session && pathname !== '/login') {
  ```
  to:
  ```typescript
  if (!session && pathname !== '/login' && !pathname.startsWith('/set-password')) {
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd apps/web && npm run build 2>&1 | tail -20
  ```
  Expected: build succeeds or only pre-existing warnings (no new type errors).

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/lib/auth.ts apps/web/middleware.ts
  git commit -m "feat(auth): add credentials provider with bcrypt, Google domain restriction"
  ```

---

### Task 4: Login UI Redesign

**Files:**
- Modify: `apps/web/components/Login.tsx`

**Interfaces:**
- Consumes: `signIn('credentials', ...)` and `signIn('google', ...)` from `next-auth/react`; `NEXT_PUBLIC_AUTH_TEST_MODE` env var
- Produces: redesigned Login component; error codes `CredentialsSignin`, `AccessDenied`, `PasswordNotSet` mapped to Italian messages; `?message=password-set` banner; `?message=password-set` query param support

- [ ] **Step 1: Replace `apps/web/components/Login.tsx` with the redesigned version**

  ```typescript
  'use client'

  import React, { Suspense, useState } from 'react'
  import { signIn } from 'next-auth/react'
  import { useSearchParams } from 'next/navigation'
  import { Eye, EyeOff } from 'lucide-react'

  const ERROR_MESSAGES: Record<string, string> = {
    CredentialsSignin: 'Email o password non corretti.',
    AccessDenied: 'Accesso negato. Non sei autorizzato ad accedere.',
    PasswordNotSet: 'Imposta prima la tua password tramite il link ricevuto via email.',
    OAuthSignin: 'Errore durante l\'accesso. Riprova.',
    OAuthCallback: 'Errore durante il callback OAuth. Riprova.',
    Default: 'Si è verificato un errore durante l\'accesso. Riprova.',
  }

  const isTestMode = process.env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true'

  function GoogleIcon() {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
    )
  }

  function LoginForm() {
    const searchParams = useSearchParams()
    const errorCode = searchParams.get('error')
    const message = searchParams.get('message')
    const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null
    const successMessage = message === 'password-set' ? 'Password impostata con successo. Puoi accedere.' : null

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [testEmail, setTestEmail] = useState('')
    const [testExpanded, setTestExpanded] = useState(false)
    const [testLoading, setTestLoading] = useState(false)

    const handleCredentialsLogin = async (e: React.FormEvent) => {
      e.preventDefault()
      setLoading(true)
      await signIn('credentials', { email, password, callbackUrl: '/' })
      setLoading(false)
    }

    const handleTestLogin = async (e: React.FormEvent) => {
      e.preventDefault()
      setTestLoading(true)
      await signIn('test-credentials', { email: testEmail, callbackUrl: '/' })
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">

          {/* Header */}
          <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
            <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>
              Piattaforma — Frontiere Technologies
            </p>
          </div>

          {/* Body */}
          <div className="bg-white px-8 py-8 flex flex-col gap-4">

            {successMessage && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                {successMessage}
              </div>
            )}

            <form onSubmit={handleCredentialsLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="nome@esempio.it"
                  className="rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {errorMessage && (
                <p className="text-red-600 text-sm">{errorMessage}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50"
                style={{ borderColor: '#0f5a8a', color: '#0f5a8a' }}
                onMouseEnter={e => {
                  if (!loading) {
                    const btn = e.currentTarget
                    btn.style.backgroundColor = '#0f5a8a'
                    btn.style.color = 'white'
                  }
                }}
                onMouseLeave={e => {
                  const btn = e.currentTarget
                  btn.style.backgroundColor = ''
                  btn.style.color = '#0f5a8a'
                }}
              >
                {loading ? 'Accesso in corso…' : 'Accedi'}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">oppure</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Google button */}
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: '/' })}
              className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition shadow-sm"
            >
              <GoogleIcon />
              Continua con Google
            </button>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-200 px-8 py-4 text-center">
            <p className="text-xs text-gray-500">
              Problemi di accesso?{' '}
              <span className="text-gray-700">Contatta l'amministratore.</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Non hai un account?{' '}
              <a
                href="#"
                onClick={e => e.preventDefault()}
                className="font-semibold"
                style={{ color: '#0f5a8a' }}
              >
                Registrati
              </a>
            </p>

            {isTestMode && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setTestExpanded(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Accesso test {testExpanded ? '▴' : '▾'}
                </button>
                {testExpanded && (
                  <form onSubmit={handleTestLogin} className="flex flex-col gap-2 mt-2">
                    <input
                      type="email"
                      placeholder="Email di test"
                      value={testEmail}
                      onChange={e => setTestEmail(e.target.value)}
                      required
                      className="border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                    <button
                      type="submit"
                      disabled={testLoading}
                      className="bg-gray-500 text-white rounded-lg py-2 text-xs font-semibold hover:bg-gray-600 disabled:opacity-50 transition"
                    >
                      {testLoading ? 'Accesso…' : 'Entra (test)'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    )
  }

  export function Login() {
    return (
      <Suspense>
        <LoginForm />
      </Suspense>
    )
  }
  ```

- [ ] **Step 2: Start the dev server and visually verify the login page**

  ```bash
  cd apps/web && npm run dev
  ```
  Open `http://localhost:3000/login` and confirm:
  - Dark navy header with "Construct" title
  - Email + password fields with eye toggle
  - "Accedi" button with navy border
  - "oppure" divider
  - "Continua con Google" button with Google G logo
  - Footer with "Problemi di accesso?" and "Registrati" link (clicking does nothing)

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/components/Login.tsx
  git commit -m "feat(ui): redesign login page — email/password, Google button, Italian copy"
  ```

---

### Task 5: Set Password API Route

**Files:**
- Create: `apps/web/app/api/auth/set-password/route.ts`

**Interfaces:**
- Consumes: `password_set_tokens` table (Task 1), `users.password_hash` (Task 1), `bcryptjs` (Task 2)
- Produces: `POST /api/auth/set-password` — accepts `{ token: string, password: string }`; returns `200` on success, `400` on validation error, `410` on expired/used token

- [ ] **Step 1: Create `apps/web/app/api/auth/set-password/route.ts`**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import bcrypt from 'bcryptjs'
  import { createAdminClient } from '@/lib/supabase-server'

  export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null)
    const { token, password } = body ?? {}

    if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Parametri mancanti.' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'La password deve essere di almeno 8 caratteri.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: tokenRow } = await supabase
      .from('password_set_tokens')
      .select('id, user_id, expires_at, used_at')
      .eq('token', token)
      .single()

    if (!tokenRow) {
      return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
    }
    if (tokenRow.used_at) {
      return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
    }

    const hash = await bcrypt.hash(password, 10)

    const { error: updateErr } = await supabase
      .from('users')
      .update({ password_hash: hash })
      .eq('id', tokenRow.user_id)

    if (updateErr) {
      console.error('[set-password] Failed to update password_hash:', updateErr)
      return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
    }

    await supabase
      .from('password_set_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)

    return NextResponse.json({ ok: true })
  }
  ```

- [ ] **Step 2: Build to verify no TypeScript errors**

  ```bash
  cd apps/web && npm run build 2>&1 | grep -E 'error|Error' | head -10
  ```
  Expected: no new errors.

- [ ] **Step 3: Test the route with curl (start dev server first)**

  Test with missing params:
  ```bash
  curl -s -X POST http://localhost:3000/api/auth/set-password \
    -H "Content-Type: application/json" \
    -d '{}' | jq .
  ```
  Expected: `{"error":"Parametri mancanti."}`

  Test with invalid token:
  ```bash
  curl -s -X POST http://localhost:3000/api/auth/set-password \
    -H "Content-Type: application/json" \
    -d '{"token":"nonexistent","password":"test12345"}' | jq .
  ```
  Expected: `{"error":"Link non valido."}`

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/api/auth/set-password/route.ts
  git commit -m "feat(api): add POST /api/auth/set-password route"
  ```

---

### Task 6: Admin Send Invite API Route

**Files:**
- Create: `apps/web/app/api/admin/send-invite/route.ts`

**Interfaces:**
- Consumes: `password_set_tokens` table (Task 1), `users` table, `resend` (Task 2), `RESEND_API_KEY` and `RESEND_FROM` env vars
- Produces: `POST /api/admin/send-invite` — accepts `{ userId: string }`; creates token, sends email; returns `200` on success, `403` if not admin, `404` if user not found

- [ ] **Step 1: Create `apps/web/app/api/admin/send-invite/route.ts`**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { Resend } from 'resend'
  import { auth } from '@/lib/auth'
  import { createAdminClient } from '@/lib/supabase-server'

  export async function POST(req: NextRequest) {
    const session = await auth()
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const { userId } = body ?? {}

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: user } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', userId)
      .single()

    if (!user?.email) {
      return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
    }

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

    const { error: insertErr } = await supabase
      .from('password_set_tokens')
      .insert({ user_id: user.id, token, expires_at: expiresAt })

    if (insertErr) {
      console.error('[send-invite] Failed to create token:', insertErr)
      return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
    }

    const host = req.headers.get('host') ?? 'localhost:3000'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const setPasswordUrl = `${protocol}://${host}/set-password?token=${token}`

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailErr } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'noreply@frontiere.io',
      to: user.email,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })

    if (emailErr) {
      console.error('[send-invite] Resend error:', emailErr)
      return NextResponse.json({ error: 'Errore invio email.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }
  ```

- [ ] **Step 2: Build to verify no TypeScript errors**

  ```bash
  cd apps/web && npm run build 2>&1 | grep -E 'error|Error' | head -10
  ```
  Expected: no new errors.

- [ ] **Step 3: Test unauthenticated request returns 403**

  With dev server running:
  ```bash
  curl -s -X POST http://localhost:3000/api/admin/send-invite \
    -H "Content-Type: application/json" \
    -d '{"userId":"test"}' | jq .
  ```
  Expected: `{"error":"Non autorizzato."}`

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/api/admin/send-invite/route.ts
  git commit -m "feat(api): add POST /api/admin/send-invite route"
  ```

---

### Task 7: Set Password Page

**Files:**
- Create: `apps/web/app/set-password/page.tsx`
- Create: `apps/web/app/set-password/SetPasswordForm.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/set-password` (Task 5); `password_set_tokens` table (Task 1)
- Produces: `/set-password?token=<uuid>` — server-validates token, renders form or error; on success redirects to `/login?message=password-set`

- [ ] **Step 1: Create `apps/web/app/set-password/SetPasswordForm.tsx`**

  ```typescript
  'use client'

  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import { Eye, EyeOff } from 'lucide-react'

  export function SetPasswordForm({ token }: { token: string }) {
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      if (password.length < 8) {
        setError('La password deve essere di almeno 8 caratteri.')
        return
      }
      if (password !== confirm) {
        setError('Le password non corrispondono.')
        return
      }

      setLoading(true)
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      setLoading(false)

      if (!res.ok) {
        setError(data.error ?? 'Errore sconosciuto.')
        return
      }

      router.push('/login?message=password-set')
    }

    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="new-password">
            Nuova password
          </label>
          <div className="relative">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Minimo 8 caratteri"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="confirm-password">
            Conferma password
          </label>
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            placeholder="Ripeti la password"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50"
          style={{ borderColor: '#0f5a8a', color: '#0f5a8a' }}
        >
          {loading ? 'Salvataggio…' : 'Imposta password'}
        </button>
      </form>
    )
  }
  ```

- [ ] **Step 2: Create `apps/web/app/set-password/page.tsx`**

  ```typescript
  import { createAdminClient } from '@/lib/supabase-server'
  import { SetPasswordForm } from './SetPasswordForm'

  interface Props {
    searchParams: Promise<{ token?: string }>
  }

  export default async function SetPasswordPage({ searchParams }: Props) {
    const { token } = await searchParams

    const invalid = !token || typeof token !== 'string'

    if (!invalid) {
      const supabase = createAdminClient()
      const { data: tokenRow } = await supabase
        .from('password_set_tokens')
        .select('id, expires_at, used_at')
        .eq('token', token)
        .single()

      const isValid =
        tokenRow &&
        !tokenRow.used_at &&
        new Date(tokenRow.expires_at) >= new Date()

      if (!isValid) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
              <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
                <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
              </div>
              <div className="bg-white px-8 py-8 text-center">
                <p className="text-red-600 font-medium">Link non valido o scaduto.</p>
                <p className="text-gray-500 text-sm mt-2">Contatta l'amministratore per ricevere un nuovo invito.</p>
              </div>
            </div>
          </div>
        )
      }
    }

    if (invalid) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
            <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
              <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            </div>
            <div className="bg-white px-8 py-8 text-center">
              <p className="text-red-600 font-medium">Link non valido.</p>
              <p className="text-gray-500 text-sm mt-2">Contatta l'amministratore.</p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
          <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
            <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>Imposta la tua password</p>
          </div>
          <div className="bg-white px-8 py-8">
            <SetPasswordForm token={token!} />
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 3: Build to verify no TypeScript errors**

  ```bash
  cd apps/web && npm run build 2>&1 | tail -20
  ```
  Expected: build succeeds.

- [ ] **Step 4: End-to-end smoke test**

  Insert a test token directly in Supabase (replace `<user-id>` with an existing user's UUID from the `users` table):

  Use `mcp__supabase__execute_sql`:
  ```sql
  -- Get a user id to test with
  select id, email from users limit 1;
  ```

  Then insert a token:
  ```sql
  insert into password_set_tokens (user_id, token, expires_at)
  values ('<user-id>', 'test-token-abc123', now() + interval '48 hours');
  ```

  With dev server running, visit:
  `http://localhost:3000/set-password?token=test-token-abc123`

  Confirm:
  - Form renders with "Nuova password" and "Conferma password" fields
  - Submitting mismatched passwords shows "Le password non corrispondono."
  - Submitting < 8 chars shows "La password deve essere di almeno 8 caratteri."
  - Submitting a valid password redirects to `/login?message=password-set`
  - Login page shows green "Password impostata con successo." banner

  Verify in DB:
  ```sql
  select password_hash is not null, used_at is not null
  from users u join password_set_tokens t on u.id = t.user_id
  where t.token = 'test-token-abc123';
  ```
  Expected: both `true`.

  Test expired/used token:
  `http://localhost:3000/set-password?token=test-token-abc123` (same token, now marked used)
  Expected: error page "Link non valido o scaduto."

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/app/set-password/page.tsx apps/web/app/set-password/SetPasswordForm.tsx
  git commit -m "feat: add /set-password page and form for invite flow"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ DB: `password_hash`, `password_set_tokens`, `allowed_domains` with `frontiere.io` seed (Task 1)
- ✅ Dependencies: `resend`, `bcryptjs` (Task 2)
- ✅ Credentials provider with bcrypt + PasswordNotSet error code (Task 3)
- ✅ Google domain check with 60s cache (Task 3)
- ✅ Middleware allows `/set-password` unauthenticated (Task 3)
- ✅ Login UI redesign matching mockup (Task 4)
- ✅ Italian error messages including PasswordNotSet (Task 4)
- ✅ `?message=password-set` green banner (Task 4)
- ✅ Test mode toggle (Task 4)
- ✅ POST /api/auth/set-password (Task 5)
- ✅ POST /api/admin/send-invite with admin check + Resend email (Task 6)
- ✅ `/set-password` page with token validation + form (Task 7)
- ✅ `RESEND_API_KEY`, `RESEND_FROM` added to `.env.template` (Task 2)
- ✅ `deploy/db/schema.sql` updated (Task 1)

**One note:** The `CredentialsSignin` import from `next-auth` may not be available in all next-auth v5 beta builds. If `import NextAuth, { CredentialsSignin } from 'next-auth'` causes a TypeScript error, replace the custom error throw in `authorize` with:
```typescript
// Fallback if CredentialsSignin is not exported:
throw Object.assign(new Error('PasswordNotSet'), { code: 'PasswordNotSet' })
```
The `?error=PasswordNotSet` URL param will still be set in Auth.js v5.
