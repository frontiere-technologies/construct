# Code Review Report — Branch `feature/oidc`

- **Date**: 2026-06-23
- **Reviewer**: Senior Code Reviewer
- **Target Branch**: `feature/oidc`
- **Base Branch**: `origin/development`
- **Scope**: Authentication migration to Auth.js (OIDC, Credentials), Supabase client rework, and security architecture validation.

---

## 1. Executive Summary

This report covers a comprehensive audit of the code changes introducing OpenID Connect (OIDC) and local credential-based authentication using **Auth.js v5** (NextAuth) and **Tailwind CSS v4** in **React 19**.

### Key Findings
* **Critical Security Vulnerability (P0)**: Row Level Security (RLS) has been explicitly disabled on all Supabase tables. Because Supabase exposes an auto-generated REST API via PostgREST utilizing a public anonymous key, anyone can query, alter, or delete records in these tables (including user details and password hashes).
* **Functional Regression (P2)**: User avatars have been removed from the Sidebar component because the new Auth.js context does not map the session image field to the client state.
* **Technical Debt & Performance (P1/P2)**: Redundant database writes exist on every credential-based login and profile page render. In addition, the password-reset flow lacks atomicity, which can lead to locked-out users under failure conditions.

---

## 2. Summary Table

| ID | Severity | Complexity | Status | Priority | Title | Fix description |
|----|----------|------------|--------|----------|-------|------------------|
| **SEC-1** | Critical | Low | ✅ Fixed | P0 | Public Exposure of Database via PostgREST due to Disabled RLS | Enable Row Level Security (`alter table ... enable row level security;`) on all tables with no public policies, forcing all client access through server-side service-role queries. |
| **ERR-1** | High | Medium | ✅ Fixed | P1 | Non-Transactional Token Consumption in Password Reset Flow | Wrap token consumption and user password updates in a single Postgres transaction or update the user first to prevent invalidating tokens when password updates fail. |
| **PERF-1** | Medium | Low | ✅ Fixed | P2 | Redundant User Upsert in NextAuth jwt Callback for Credentials Login | Check the authentication provider in the `jwt` callback and bypass database upsert writes for credentials-based sign-ins. |
| **STYLE-1** | Medium | Low | ✅ Fixed | P2 | Hardcoded Inline Hex Colors and JS Hover Handlers in Components | Move the custom blue hex color (`#0f5a8a`) into the Tailwind v4 `@theme` directive in `globals.css` and use standard CSS utility classes. |
| **REG-1** | Medium | Low | ✅ Fixed | P2 | Sidebar User Avatar Regression due to Incomplete Session Mapping | Add `image: session.user.image` to the `useAuth` hook profile structure and restore the custom avatar image element in the Sidebar. |
| **ERR-2** | Low | Low | ✅ Fixed | P3 | Lack of Error Recovery in Allowed Domains Fetching | Capture database query errors inside `getAllowedDomains` to prevent caching empty results and blocking login requests. |
| **PERF-2** | Low | Low | ✅ Fixed | P3 | Redundant User Profile Upsert on Page Render | Remove the lazy-init user upsert check in `ProfilePage` since users are already provisioned during the sign-in phase. |
| **TEST-1** | Low | Low | ✅ Fixed | P3 | Headless Browser Setting Hardcoded to False in `conftest.py` | Restore `headless=True` as the default Playwright test configuration to ensure successful test runs in headless CI environments. |

---

## 3. Detailed Analysis

### Security

#### SEC-1: Public Exposure of Database via PostgREST due to Disabled RLS
* **Location**: [schema.sql](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/deploy/db/schema.sql#L33-L77)
* **Risk**: High risk of data breach and unauthorized database modifications.
* **Details**: In `schema.sql`, the following statements disable Row Level Security:
  ```sql
  alter table menu_items disable row level security;
  alter table users disable row level security;
  alter table password_set_tokens disable row level security;
  alter table allowed_domains disable row level security;
  ```
  Since `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a public client-facing key, anyone can query the REST endpoints exposed by PostgREST to fetch sensitive fields (like `users.password_hash` or `password_set_tokens.token`) or bypass access limits.
* **Recommendation**: Enable RLS on all tables:
  ```sql
  alter table menu_items enable row level security;
  alter table users enable row level security;
  alter table password_set_tokens enable row level security;
  alter table allowed_domains enable row level security;
  ```
  Since the server uses `createAdminClient()` (which runs with the `service_role` key bypassing RLS), this change instantly secures client access without breaking server functionalities.

---

### Logic Correctness & Error Handling

#### ERR-1: Non-Transactional Token Consumption in Password Reset Flow
* **Location**: [set-password/route.ts](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/app/api/auth/set-password/route.ts#L35-L59)
* **Risk**: High risk of locking users out on database failure.
* **Details**: During password setting, the database updates the token to mark it as used *before* updating the user's password hash:
  ```typescript
  const { data: claimed } = await supabase
    .from('password_set_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)
    .is('used_at', null)
    ...
  // Subsequent password update
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('id', tokenRow.user_id)
  ```
  If the update of `password_hash` fails due to network issues or database lockups, the token remains marked as used, but the password hash is unchanged.
* **Recommendation**: Implement a PostgreSQL function (RPC) to handle both steps atomically in a transaction, or execute the password update first and only consume the token if that update completes successfully.

#### ERR-2: Lack of Error Recovery in Allowed Domains Fetching
* **Location**: [auth.ts](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/lib/auth.ts#L10-L22)
* **Risk**: Temporary network failures can lock out all OIDC users for 60 seconds.
* **Details**:
  ```typescript
  const { data } = await supabase
    .from('allowed_domains')
    .select('domain')
    .eq('active', true)
  const domains = (data ?? []).map((r: { domain: string }) => r.domain)
  ```
  If the Supabase connection fails, `data` is null and an empty domain list is cached. This blocks all Google, Microsoft, and Keycloak authentication requests for the next 60 seconds.
* **Recommendation**: Check for query errors:
  ```typescript
  const { data, error } = await supabase.from('allowed_domains').select('domain').eq('active', true);
  if (error) {
    console.error('[auth] Failed to retrieve allowed domains:', error);
    // Reuse previous cache, throw an error, or retry immediately without caching the error state
  }
  ```

---

### Performance

#### PERF-1: Redundant User Upsert in NextAuth jwt Callback for Credentials Login
* **Location**: [auth.ts](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/lib/auth.ts#L159-L186)
* **Details**: In the `jwt` callback, `upsert` is executed on every login request to provision users:
  ```typescript
  const { data } = await supabase.from('users').upsert({ email: user.email, ... })
  ```
  This is essential for external OIDC logins, but credentials-based logins already have their accounts established in the `users` table. Re-running the `upsert` adds an unnecessary database write query to every standard login.
* **Recommendation**: Skip `upsert` for standard credentials provider sessions:
  ```typescript
  if (account.provider === 'credentials') {
    token.userId = user.id;
    token.role = (user as any).role ?? 'user';
  } else {
    // Provision OIDC user
    ...
  }
  ```

#### PERF-2: Redundant User Profile Upsert on Page Render
* **Location**: [profile/page.tsx](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/app/\(protected\)/profile/page.tsx#L10-L12)
* **Details**: The profile page runs an upsert query to provision a profile row if it doesn't exist:
  ```typescript
  await supabase
    .from('users')
    .upsert({ id: session.user.id, email: session.user.email }, { ignoreDuplicates: true })
  ```
  Since users are already provisioned upon registration (or during their first OIDC login in the `jwt` callback), this write operation is redundant and introduces latency.
* **Recommendation**: Remove the `upsert` call; query the user details directly.

---

### Design Patterns & Styling

#### STYLE-1: Hardcoded Inline Hex Colors and JS Hover Handlers in Components
* **Location**: [Login.tsx](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/components/Login.tsx#L157-L175) and [SetPasswordForm.tsx](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/app/set-password/SetPasswordForm.tsx#L96)
* **Details**: The primary brand color `#0f5a8a` is styled inline, and mouse event handlers are used in JS to compute hover effects:
  ```typescript
  style={{ borderColor: '#0f5a8a', color: '#0f5a8a' }}
  onMouseEnter={e => { ... }}
  onMouseLeave={e => { ... }}
  ```
  This bypasses Tailwind CSS features and theme tokens, creating maintenance overhead.
* **Recommendation**: Define the brand color in `globals.css` inside the `@theme` block:
  ```css
  @theme {
    --color-brand-blue: #0f5a8a;
  }
  ```
  Then replace style props with Tailwind CSS classes: `border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white`.

#### REG-1: Sidebar User Avatar Regression due to Incomplete Session Mapping
* **Location**: [AuthContext.tsx](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/context/AuthContext.tsx#L21-L28) and [Sidebar.tsx](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/components/Sidebar.tsx#L400-L404)
* **Details**: The avatar element in the sidebar was replaced with a static icon because `AuthContext` only extracts basic user properties from the session, discarding the `image` field.
* **Recommendation**: Add `image` to the `AuthUser` interface and return `image: session.user.image` inside `useAuth()`. Update the user panel button in the sidebar to render the user image if available.

---

### E2E Testing

#### TEST-1: Headless Browser Setting Hardcoded to False in `conftest.py`
* **Location**: [conftest.py](file:///Users/mario.stefanutti/mario/programming/github-frontiere/construct/tests/e2e/conftest.py#L30)
* **Details**: Playwright is configured with `headless=False`:
  ```python
  b = p.chromium.launch(headless=False, slow_mo=50)
  ```
  This will crash tests on systems without screen display servers (such as container environments and CI environments like GitHub Actions).
* **Recommendation**: Change back to `headless=True` by default, or retrieve it from an environment variable:
  ```python
  headless_mode = os.getenv("HEADLESS", "true").lower() == "true"
  b = p.chromium.launch(headless=headless_mode)
  ```
