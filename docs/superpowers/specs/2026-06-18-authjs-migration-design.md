# Auth.js Migration Design

**Date:** 2026-06-18  
**Branch:** feature/oidc  
**Status:** Approved

## Context

The application currently uses Supabase Auth (`@supabase/ssr`) for authentication, with email+password login only. The goal is to replace Supabase Auth with Auth.js (NextAuth.js v5) to support any OIDC-compatible provider (Microsoft Entra ID, Google, Keycloak, and others configurable via env vars).

Supabase **remains as the PostgreSQL database** for all application data (`menu_items`, `users`, etc.). Only the authentication layer is replaced.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth library | Auth.js v5 (next-auth) | Native OIDC support, Next.js App Router integration |
| Session strategy | JWT stateless | Edge-compatible, no DB round-trip per request |
| Login method | OIDC only | Remove email+password entirely |
| RLS | Disabled | With Auth.js, JWTs don't carry Supabase `auth.uid()` claims; server-side authorization via middleware is the security boundary |
| User provisioning | Automatic on first login | `jwt` callback upserts user into Supabase `users` table by email |
| Role storage | Stored in Supabase `users.role`, cached in JWT on login | Roles change rarely; relogin refreshes the cached value |

## Architecture

```
Browser ──► Next.js middleware (Auth.js)
                │
                ├─ Unauthenticated → redirect /login
                ├─ Authenticated, /admin, role ≠ admin → redirect /
                └─ Authenticated → pass through

/login ──► Auth.js signIn(providerId)
                │
                └─► OIDC Provider (Microsoft / Google / Keycloak / …)
                         │
                         └─► /api/auth/callback/[provider]
                                  │
                                  └─► jwt callback
                                           ├─ upsert user in Supabase by email
                                           └─ store { id, role } in JWT
```

## File Inventory

| File | Action |
|---|---|
| `middleware.ts` | Rewritten: Auth.js middleware, no Supabase client |
| `lib/auth.ts` | Rewritten: central Auth.js config (providers, callbacks) |
| `lib/supabase-server.ts` | Updated: expose `createAdminClient()` with service role key |
| `lib/supabase-browser.ts` | Deleted: no direct DB access from browser |
| `lib/menu-service.ts` | Updated: use `createAdminClient()` instead of `createClient()` |
| `lib/menu-actions.ts` | Updated: use `createAdminClient()` instead of browser client |
| `context/AuthContext.tsx` | Rewritten: wraps `useSession` / `signOut` from `next-auth/react` |
| `components/Login.tsx` | Rewritten: OIDC buttons only, no email/password form |
| `app/providers.tsx` | Updated: replace `AuthProvider` with `SessionProvider` from `next-auth/react` |
| `app/api/auth/[...nextauth]/route.ts` | New: Auth.js route handler |
| `app/(protected)/layout.tsx` | Updated: `getUserRole()` removed, role comes from session |
| `deploy/supabase/schema.sql` | Updated: remove FK to `auth.users`, disable RLS, drop policies |

## Auth.js Configuration (`lib/auth.ts`)

```ts
import NextAuth from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import { createAdminClient } from '@/lib/supabase-server'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      tenantId: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID!,
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID!,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET!,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER!,
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        const supabase = createAdminClient()
        const { data } = await supabase
          .from('users')
          .upsert(
            { email: user.email, name: user.name, avatar: user.image },
            { onConflict: 'email', ignoreDuplicates: false }
          )
          .select('id, role')
          .single()
        token.userId = data?.id
        token.role = data?.role ?? 'user'
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

## Middleware (`middleware.ts`)

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

## Database Migration

```sql
-- Remove FK to Supabase auth.users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Default PK to app-generated UUID
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Ensure email is unique (used as upsert conflict target)
-- IF NOT EXISTS is not supported for ADD CONSTRAINT in PostgreSQL; skip if already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END$$;

-- Disable RLS — server-side middleware is the security boundary
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items DISABLE ROW LEVEL SECURITY;

-- Drop now-redundant policies
DROP POLICY IF EXISTS "menu_items_select_authenticated" ON menu_items;
DROP POLICY IF EXISTS "menu_items_insert_admin" ON menu_items;
DROP POLICY IF EXISTS "menu_items_update_admin" ON menu_items;
DROP POLICY IF EXISTS "menu_items_delete_admin" ON menu_items;
```

## Environment Variables

```env
# Required by Auth.js v5
AUTH_SECRET=<random 32+ byte secret>

# Microsoft Entra ID (optional — include only if using this provider)
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=

# Google (optional)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Keycloak (optional)
AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=https://keycloak.example.com/realms/myrealm

# Supabase — keep for DB access, add service role key
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # can be removed if no public queries remain
SUPABASE_SERVICE_ROLE_KEY=          # new — server-only, never exposed to browser
```

## Auth Context (`context/AuthContext.tsx`)

```tsx
'use client'
import { useSession, signOut as nextAuthSignOut } from 'next-auth/react'

interface AuthContextType {
  user: { id: string; name?: string | null; email?: string | null; role: string } | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthContextType {
  const { data: session, status } = useSession()
  return {
    user: session?.user ?? null,
    loading: status === 'loading',
    signOut: () => nextAuthSignOut({ callbackUrl: '/login' }),
  }
}
```

`AuthProvider` is removed. `app/providers.tsx` wraps children in `SessionProvider` from `next-auth/react`.

## Login Component (`components/Login.tsx`)

Renders one button per configured provider. Providers are determined at build/runtime from env vars — for now, render buttons for each provider defined in `lib/auth.ts`. No email/password form.

## TypeScript Augmentation

Auth.js session type must be extended to include `id` and `role`:

```ts
// types/next-auth.d.ts
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { id: string; role: string } & DefaultSession['user']
  }
  interface JWT {
    userId: string
    role: string
  }
}
```

## Dependencies

**Add:**
- `next-auth@5` (Auth.js v5)

**Remove:**
- `@supabase/ssr`

**Keep:**
- `@supabase/supabase-js` (used for DB queries via admin client)

## Adding a New OIDC Provider

1. Add the provider import and config to `providers[]` in `lib/auth.ts`
2. Add the required env vars to `.env.local` and deployment secrets
3. Register the callback URL `https://<domain>/api/auth/callback/<provider-id>` with the identity provider

No other code changes required.

## Error Handling

- If Supabase upsert fails in `jwt` callback: log the error, return token without `userId`/`role`; the user lands in the app as role `user` with no DB record — acceptable degraded state, will retry on next login
- If OIDC provider is misconfigured (missing env var): Auth.js omits that provider silently; document which vars are required per provider
- Auth errors from OIDC (user denied, network failure): Auth.js redirects to `/login?error=<code>`; the Login component should display a human-readable message for known codes

## Testing

- E2E tests: mock OIDC provider using Auth.js `credentials` provider in test env (already supported)
- Unit: test `jwt` and `session` callbacks in isolation with mock Supabase client
- Manual: verify each configured provider signs in, creates `users` row, populates role correctly
