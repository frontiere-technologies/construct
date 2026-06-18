# Auth.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Auth.js v5 (NextAuth) to support configurable OIDC providers (Microsoft Entra ID, Google, Keycloak) while keeping Supabase as the PostgreSQL database.

**Architecture:** JWT stateless sessions managed by Auth.js. On first login via any OIDC provider, the `jwt` callback upserts the user into the Supabase `users` table (using service role key) and stores `{ userId, role }` in the JWT. The Next.js middleware uses Auth.js to protect routes and enforce RBAC — no Supabase client in the request path.

**Tech Stack:** Next.js 15 (App Router), `next-auth@5`, `@supabase/supabase-js` (DB only), TypeScript, Playwright + pytest (E2E)

## Global Constraints

- Working directory for all Next.js files: `apps/web/`
- `@/` alias maps to `apps/web/` (see `tsconfig.json`)
- Run Next.js commands from `apps/web/` or via root `npm run web:dev`
- Run E2E tests with `uv run pytest` from repo root (never `python` or `python3`)
- No `ProtectedRoute` component — middleware handles route protection
- `postcss.config.mjs` must stay `.mjs` — do not rename
- Auth.js v5 is `next-auth` package (not `@auth/nextjs`)
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never add `NEXT_PUBLIC_` prefix to it
- Only add `CredentialsProvider` when `AUTH_TEST_CREDENTIALS=true` — never in production
- `menu-actions.ts` must use `'use server'` (Server Action) after migration — not `'use client'`

---

## File Map

| File | Change |
|---|---|
| `apps/web/package.json` | Add `next-auth@5`, remove `@supabase/ssr` |
| `apps/web/types/next-auth.d.ts` | **New** — TypeScript augmentation for session/JWT |
| `apps/web/lib/supabase-server.ts` | Add `createAdminClient()` using service role key |
| `apps/web/lib/supabase-browser.ts` | **Delete** |
| `apps/web/lib/auth.ts` | **Rewrite** — NextAuth config, providers, callbacks |
| `apps/web/app/api/auth/[...nextauth]/route.ts` | **New** — Auth.js route handler |
| `apps/web/middleware.ts` | **Rewrite** — Auth.js middleware |
| `apps/web/context/AuthContext.tsx` | **Rewrite** — wraps `useSession` / `signOut` |
| `apps/web/app/providers.tsx` | Replace `AuthProvider` with `SessionProvider` |
| `apps/web/components/Login.tsx` | **Rewrite** — OIDC buttons + test-only form |
| `apps/web/app/(protected)/layout.tsx` | Use `auth()` instead of `getUserRole()` |
| `apps/web/lib/menu-service.ts` | Use `createAdminClient()` |
| `apps/web/lib/menu-actions.ts` | Convert to `'use server'` + `createAdminClient()` |
| `apps/web/.env.local` | Add `AUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, provider vars |
| `deploy/supabase/schema.sql` | Remove FK to auth.users, disable RLS, drop policies |
| `tests/e2e/.env.test` | Add `AUTH_TEST_CREDENTIALS=true`, `NEXT_PUBLIC_AUTH_TEST_MODE=true` |
| `tests/e2e/conftest.py` | Update `logged_in_page` fixture for test credentials flow |
| `tests/e2e/test_auth.py` | Update login test for new flow |

---

## Task 1: Install dependencies and environment variables

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/.env.local` (create if absent)

**Interfaces:**
- Produces: `next-auth` available as a dependency; `AUTH_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in env

- [ ] **Step 1: Install next-auth@5 and remove @supabase/ssr**

Run from `apps/web/`:
```bash
cd apps/web
npm install next-auth@5
```

Expected: `package.json` now contains `"next-auth": "^5.x.x"`. Do **not** remove `@supabase/ssr` yet — it is still used by `lib/supabase-server.ts` until Task 11 cleans it up.

- [ ] **Step 2: Generate AUTH_SECRET**

```bash
openssl rand -base64 33
```

Copy the output — you will use it in the next step.

- [ ] **Step 3: Add environment variables to .env.local**

Open `apps/web/.env.local` and add these lines (keep existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```env
# Auth.js v5
AUTH_SECRET=<paste the openssl output here>

# Supabase service role key (server-only — never expose to browser)
SUPABASE_SERVICE_ROLE_KEY=<your supabase service role key from project settings>

# Microsoft Entra ID (leave blank if not using)
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=

# Google (leave blank if not using)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Keycloak (leave blank if not using)
AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=

# Test-only credentials provider (never set to true in production)
AUTH_TEST_CREDENTIALS=true
NEXT_PUBLIC_AUTH_TEST_MODE=true
```

- [ ] **Step 4: Verify the dev server starts**

```bash
cd apps/web
npm run dev
```

Expected: server starts on port 3000 without import errors. The app will break at runtime (login won't work yet) — that is expected. Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore: install next-auth@5"
```

---

## Task 2: TypeScript type augmentation

**Files:**
- Create: `apps/web/types/next-auth.d.ts`

**Interfaces:**
- Produces: `Session` has `user.id: string` and `user.role: string`; `JWT` has `userId: string` and `role: string` — used in Tasks 4, 6, 7, 8

- [ ] **Step 1: Create the type augmentation file**

Create `apps/web/types/next-auth.d.ts`:

```ts
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    role: string
  }
}
```

- [ ] **Step 2: Verify TypeScript accepts the augmentation**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `next-auth` types (there will be other errors from files not yet migrated — that is fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add apps/web/types/next-auth.d.ts
git commit -m "feat: add next-auth TypeScript type augmentation"
```

---

## Task 3: Supabase admin client

**Files:**
- Modify: `apps/web/lib/supabase-server.ts`
- Delete: `apps/web/lib/supabase-browser.ts`

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient` — uses `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS — consumed by Tasks 4, 8
- Keeps: `createClient(): Promise<SupabaseClient>` — used by existing server components until Task 8 migrates them

- [ ] **Step 1: Add createAdminClient() to supabase-server.ts**

Replace the full contents of `apps/web/lib/supabase-server.ts` with:

```ts
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Session-scoped client for Server Components (reads cookies, used during migration)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component context — middleware handles session refresh
          }
        },
      },
    }
  )
}

// Service-role client — bypasses RLS, server-only
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 2: Delete the browser client**

```bash
rm apps/web/lib/supabase-browser.ts
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | grep "supabase-browser" | head -10
```

Expected: errors about `supabase-browser` not found — these will be fixed in Tasks 4 and 8. No new errors from `supabase-server.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/supabase-server.ts
git commit -m "feat: add createAdminClient() with service role key, remove browser Supabase client"
```

---

## Task 4: Auth.js configuration and route handler

**Files:**
- Rewrite: `apps/web/lib/auth.ts`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Produces:
  - `auth`: server-side session getter — called as `await auth()` in Server Components and middleware
  - `handlers`: `{ GET, POST }` route handlers for `/api/auth/*`
  - `signIn(providerId)`: triggers OIDC redirect
  - `signOut({ callbackUrl })`: clears session, redirects
- Consumed by: Tasks 5, 6, 7, 8

- [ ] **Step 1: Rewrite lib/auth.ts**

Replace the full contents of `apps/web/lib/auth.ts` with:

```ts
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
        tenantId: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
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
          const { data } = await supabase
            .from('users')
            .upsert(
              { email: credentials.email, role: 'user' },
              { onConflict: 'email', ignoreDuplicates: false }
            )
            .select('id, email, role, name')
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
          token.userId = data?.id ?? ''
          token.role = data?.role ?? 'user'
        } catch (err) {
          console.error('[auth] Failed to provision user in Supabase:', err)
          token.userId = ''
          token.role = 'user'
        }
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.userId
      session.user.role = token.role
      return session
    },
  },
  pages: { signIn: '/login' },
})
```

- [ ] **Step 2: Create the route handler**

Create directory and file `apps/web/app/api/auth/[...nextauth]/route.ts`:

```bash
mkdir -p apps/web/app/api/auth/\[...nextauth\]
```

Create `apps/web/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | grep -E "lib/auth|api/auth" | head -10
```

Expected: no errors in these two files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/auth.ts apps/web/app/api/auth
git commit -m "feat: add Auth.js v5 config with OIDC providers and user provisioning callback"
```

---

## Task 5: Middleware

**Files:**
- Rewrite: `apps/web/middleware.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth` (Task 4)
- Produces: route protection and RBAC enforcement for all non-static routes

- [ ] **Step 1: Rewrite middleware.ts**

Replace the full contents of `apps/web/middleware.ts` with:

```ts
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (!session && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url))
  }
  if (session && pathname.startsWith('/admin') && session.user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url))
  }
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | grep "middleware" | head -10
```

Expected: no errors from `middleware.ts`.

- [ ] **Step 3: Start dev server and verify redirect**

```bash
cd apps/web && npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/
```

Expected: `307 http://localhost:3000/login` (unauthenticated redirect to /login).

Kill dev server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat: replace Supabase middleware with Auth.js middleware"
```

---

## Task 6: Auth context and providers

**Files:**
- Rewrite: `apps/web/context/AuthContext.tsx`
- Modify: `apps/web/app/providers.tsx`

**Interfaces:**
- Produces: `useAuth()` hook returning `{ user: { id, name, email, role } | null, loading: boolean, signOut: () => Promise<void> }`
- Consumed by: `components/Sidebar.tsx` (already uses `useAuth`)

- [ ] **Step 1: Rewrite AuthContext.tsx**

Replace the full contents of `apps/web/context/AuthContext.tsx` with:

```tsx
'use client'

import { useSession, signOut as nextAuthSignOut } from 'next-auth/react'

interface AuthUser {
  id: string
  name?: string | null
  email?: string | null
  role: string
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
        role: session.user.role,
      }
    : null

  return {
    user,
    loading: status === 'loading',
    signOut: () => nextAuthSignOut({ callbackUrl: '/login' }),
  }
}
```

- [ ] **Step 2: Update app/providers.tsx**

Replace the full contents of `apps/web/app/providers.tsx` with:

```tsx
'use client'

import { SessionProvider } from 'next-auth/react'
import { UIProvider } from '@/context/UIContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UIProvider>
        {children}
      </UIProvider>
    </SessionProvider>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | grep -E "AuthContext|providers" | head -10
```

Expected: no errors in these files. `Sidebar.tsx` should continue to work since `useAuth()` still returns the same interface.

- [ ] **Step 4: Commit**

```bash
git add apps/web/context/AuthContext.tsx apps/web/app/providers.tsx
git commit -m "feat: migrate AuthContext to next-auth useSession, replace AuthProvider with SessionProvider"
```

---

## Task 7: Login component

**Files:**
- Rewrite: `apps/web/components/Login.tsx`

**Interfaces:**
- Consumes: `signIn` from `next-auth/react`; `NEXT_PUBLIC_AUTH_TEST_MODE` env var
- Produces: login page with OIDC buttons and (in test mode) a test email form

- [ ] **Step 1: Rewrite Login.tsx**

Replace the full contents of `apps/web/components/Login.tsx` with:

```tsx
'use client'

import React, { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Error starting sign-in. Try again.',
  OAuthCallback: 'Error during sign-in callback. Try again.',
  OAuthCreateAccount: 'Could not create account. Contact your administrator.',
  AccessDenied: 'Access denied. You are not authorized to sign in.',
  Default: 'An error occurred during sign-in.',
}

const isTestMode = process.env.NEXT_PUBLIC_AUTH_TEST_MODE === 'true'

export function Login() {
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null

  const [testEmail, setTestEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await signIn('test-credentials', { email: testEmail, callbackUrl: '/' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center">Sign In</h1>

        {errorMessage && (
          <p className="text-red-500 text-sm text-center">{errorMessage}</p>
        )}

        <button
          onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/' })}
          className="bg-blue-600 text-white rounded-lg py-2 font-semibold hover:bg-blue-700 transition"
        >
          Sign in with Microsoft
        </button>

        <button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="bg-red-500 text-white rounded-lg py-2 font-semibold hover:bg-red-600 transition"
        >
          Sign in with Google
        </button>

        <button
          onClick={() => signIn('keycloak', { callbackUrl: '/' })}
          className="bg-gray-700 text-white rounded-lg py-2 font-semibold hover:bg-gray-800 transition"
        >
          Sign in with Keycloak
        </button>

        {isTestMode && (
          <form onSubmit={handleTestLogin} className="flex flex-col gap-2 mt-2 border-t pt-4">
            <p className="text-xs text-gray-400 text-center">Test mode only</p>
            <input
              type="email"
              placeholder="Test email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              required
              className="border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-gray-500 text-white rounded-lg py-2 font-semibold hover:bg-gray-600 disabled:opacity-50 transition text-sm"
            >
              {loading ? 'Signing in...' : 'Test Login'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | grep "Login" | head -10
```

Expected: no errors from `Login.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/Login.tsx
git commit -m "feat: rewrite Login component with OIDC buttons and test-mode credentials form"
```

---

## Task 8: Protected layout and menu services

**Files:**
- Modify: `apps/web/app/(protected)/layout.tsx`
- Modify: `apps/web/lib/menu-service.ts`
- Rewrite: `apps/web/lib/menu-actions.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth` (Task 4); `createAdminClient()` from `@/lib/supabase-server` (Task 3)
- `menu-actions.ts` becomes a Server Action module — client components import and call these functions directly; Next.js proxies the call to the server automatically

- [ ] **Step 1: Update app/(protected)/layout.tsx**

Replace the full contents of `apps/web/app/(protected)/layout.tsx` with:

```tsx
import { auth } from '@/lib/auth'
import { getMenuItems } from '@/lib/menu-service'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, session] = await Promise.all([getMenuItems(), auth()])
  const userRole = session?.user?.role ?? 'user'

  const filteredItems = menuItems.filter(i =>
    i.roles.length === 0 || i.roles.includes(userRole)
  )

  return <Layout menuItems={filteredItems}>{children}</Layout>
}
```

- [ ] **Step 2: Update lib/menu-service.ts**

Replace the full contents of `apps/web/lib/menu-service.ts` with:

```ts
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { mapFromDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export const getMenuItems = cache(async (): Promise<MenuItem[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)
  return (data ?? []).map(mapFromDb)
})
```

- [ ] **Step 3: Rewrite lib/menu-actions.ts as a Server Action**

Replace the full contents of `apps/web/lib/menu-actions.ts` with:

```ts
'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { mapToDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export async function upsertMenuItem(item: MenuItem): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('menu_items')
    .upsert(mapToDb(item), { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteMenuItem(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateMenuItemOrders(
  updates: Array<{ id: string; order: number }>
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('update_menu_orders', { updates })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Full TypeScript check**

```bash
cd apps/web
npx tsc --noEmit 2>&1 | head -30
```

Expected: zero TypeScript errors. If there are errors, fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(protected\)/layout.tsx apps/web/lib/menu-service.ts apps/web/lib/menu-actions.ts
git commit -m "feat: migrate layout and menu services to Auth.js session and admin Supabase client"
```

---

## Task 9: Database migration

**Files:**
- Modify: `deploy/supabase/schema.sql`

**Interfaces:**
- Produces: `users` table with no FK to `auth.users`, UUID default PK, unique email constraint; RLS disabled on `users` and `menu_items`

- [ ] **Step 1: Apply migration via Supabase dashboard or CLI**

Open the Supabase SQL editor for your project and run:

```sql
-- Remove FK dependency on Supabase auth.users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Default PK to app-generated UUID (for new rows when id is not provided)
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Add unique constraint on email (Auth.js upsert conflict target)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END$$;

-- Disable RLS — server-side Auth.js middleware is the security boundary
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items DISABLE ROW LEVEL SECURITY;

-- Drop now-redundant Supabase Auth policies
DROP POLICY IF EXISTS "menu_items_select_authenticated" ON menu_items;
DROP POLICY IF EXISTS "menu_items_insert_admin" ON menu_items;
DROP POLICY IF EXISTS "menu_items_update_admin" ON menu_items;
DROP POLICY IF EXISTS "menu_items_delete_admin" ON menu_items;
```

Expected: all statements complete without error.

- [ ] **Step 2: Update deploy/supabase/schema.sql to reflect new state**

In `deploy/supabase/schema.sql`:

1. Find the `users` table definition and remove the line `id uuid primary key references auth.users(id)`. Replace with:
   ```sql
   id uuid primary key default gen_random_uuid(),
   ```

2. Add after the `email text,` line:
   ```sql
   -- unique constraint required for Auth.js upsert conflict resolution
   ```
   And add before the closing of the CREATE TABLE:
   ```sql
   constraint users_email_unique unique (email),
   ```
   Or add separately as `ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);`

3. Remove the `alter table users enable row level security;` line (or add `disable` version).

4. Remove the `alter table menu_items enable row level security;` line.

5. Remove all four `create policy` blocks for `menu_items`.

6. The `is_admin()` function can be removed since it referenced `auth.uid()` and is no longer used.

- [ ] **Step 3: Commit**

```bash
git add deploy/supabase/schema.sql
git commit -m "feat: remove Supabase auth FK, disable RLS, drop auth-dependent policies"
```

---

## Task 10: E2E test adaptation

**Files:**
- Modify: `tests/e2e/.env.test`
- Modify: `tests/e2e/conftest.py`
- Modify: `tests/e2e/test_auth.py`

**Interfaces:**
- Consumes: test credentials form rendered by `Login.tsx` when `NEXT_PUBLIC_AUTH_TEST_MODE=true` (Task 7)
- Produces: `logged_in_page` fixture that authenticates via the test credentials form instead of email/password

- [ ] **Step 1: Update .env.test**

Replace the contents of `tests/e2e/.env.test` with:

```env
TEST_EMAIL=test-e2e@construct.dev
BASE_URL=http://localhost:3000
```

Note: `TEST_PASSWORD` is removed — the test credentials provider accepts any email without a password. The app must be running with `AUTH_TEST_CREDENTIALS=true` and `NEXT_PUBLIC_AUTH_TEST_MODE=true` set (already in `apps/web/.env.local`).

- [ ] **Step 2: Update conftest.py**

Replace the full contents of `tests/e2e/conftest.py` with:

```python
import os
import pytest
from pathlib import Path
from playwright.sync_api import sync_playwright

_env_file = Path(__file__).parent / ".env.test"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())


@pytest.fixture(scope="session")
def base_url():
    return os.getenv("BASE_URL", "http://localhost:3000")


@pytest.fixture(scope="session")
def test_email():
    email = os.getenv("TEST_EMAIL", "")
    if not email:
        pytest.exit("Set TEST_EMAIL in tests/e2e/.env.test")
    return email


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def logged_in_page(page, base_url, test_email):
    """Authenticate via the test credentials form (requires AUTH_TEST_CREDENTIALS=true on server)."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[placeholder="Test email"]', test_email)
    page.click('button:has-text("Test Login")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    page.wait_for_load_state("networkidle")
    yield page
```

- [ ] **Step 3: Update test_auth.py**

Replace the full contents of `tests/e2e/test_auth.py` with:

```python
def test_unauthenticated_redirect_to_login(page, base_url):
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


def test_login_page_shows_sign_in_buttons(page, base_url):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    assert page.locator('button:has-text("Sign in with Microsoft")').is_visible()
    assert page.locator('button:has-text("Sign in with Google")').is_visible()
    assert page.locator('button:has-text("Sign in with Keycloak")').is_visible()


def test_test_login_redirects_to_home(page, base_url, test_email):
    """Verifies the test credentials flow works end-to-end."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[placeholder="Test email"]', test_email)
    page.click('button:has-text("Test Login")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    assert page.url == f"{base_url}/", f"Expected {base_url}/, got {page.url}"


def test_authenticated_login_redirects_to_home(logged_in_page, base_url):
    """Already-authenticated user visiting /login is redirected to /."""
    logged_in_page.goto(f"{base_url}/login")
    logged_in_page.wait_for_load_state("networkidle")
    assert logged_in_page.url == f"{base_url}/", f"Expected {base_url}/, got {logged_in_page.url}"
```

- [ ] **Step 4: Run E2E tests (with dev server running)**

In one terminal, start the dev server:
```bash
cd apps/web && npm run dev
```

In another terminal:
```bash
uv run pytest tests/e2e/test_auth.py -v
```

Expected output:
```
PASSED tests/e2e/test_auth.py::test_unauthenticated_redirect_to_login
PASSED tests/e2e/test_auth.py::test_login_page_shows_sign_in_buttons
PASSED tests/e2e/test_auth.py::test_test_login_redirects_to_home
PASSED tests/e2e/test_auth.py::test_authenticated_login_redirects_to_home
```

- [ ] **Step 5: Run the full E2E suite**

```bash
uv run pytest tests/e2e/ -v
```

Expected: all tests pass. If any test uses the old `credentials` fixture (which no longer exists), update it to use `test_email` and the new login flow.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/.env.test tests/e2e/conftest.py tests/e2e/test_auth.py
git commit -m "test: update E2E tests for Auth.js test credentials flow"
```

---

## Task 11: Cleanup and final verification

**Files:**
- Modify: `apps/web/lib/supabase-server.ts` — remove `createClient()` and `@supabase/ssr` import
- Modify: `apps/web/package.json` — remove `@supabase/ssr`

- [ ] **Step 1: Remove createClient() and @supabase/ssr from supabase-server.ts**

Replace the full contents of `apps/web/lib/supabase-server.ts` with the final, clean version:

```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS, server-only, never exposed to browser
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 2: Uninstall @supabase/ssr**

```bash
cd apps/web && npm uninstall @supabase/ssr
```

Expected: `package.json` no longer contains `@supabase/ssr`.

- [ ] **Step 3: Full TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Lint**

```bash
cd apps/web && npm run lint
```

Expected: no lint errors.

- [ ] **Step 5: Full E2E suite**

With dev server running (`npm run web:dev`):

```bash
uv run pytest tests/e2e/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Manual smoke test**

1. Open `http://localhost:3000` — verify redirect to `/login`
2. On `/login`, verify OIDC buttons are visible
3. Fill in test email and click "Test Login" — verify redirect to `/`
4. Verify sidebar shows the user's name/email
5. Click sign out — verify redirect to `/login`
6. Visit `/admin/menu-builder` as a `user` role — verify redirect to `/`

- [ ] **Step 7: Final commit**

```bash
git add apps/web/lib/supabase-server.ts apps/web/package.json apps/web/package-lock.json
git commit -m "chore: remove @supabase/ssr, drop createClient() — migration complete"
```
