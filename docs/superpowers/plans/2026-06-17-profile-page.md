# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [✅]`) syntax for tracking.

**Goal:** Create a `/profile` page where authenticated users can view and edit first name, last name, username, and phone, with avatar and email displayed read-only from the IdP.

**Architecture:** A Server Component (`profile/page.tsx`) fetches the user's row from the `users` table and passes it as props to a Client Component (`ProfileForm.tsx`) that handles the editable form. A client-side helper (`profile-actions.ts`) writes back to Supabase on save, following the exact same pattern as `menu-actions.ts`. The `users` table gets four new columns via a DB migration applied to both `schema.sql` and the live Supabase instance.

**Tech Stack:** React 19 + TypeScript + Next.js 15 App Router + Tailwind CSS v4 + Supabase (`@supabase/ssr`) + Lucide React + Python Playwright (E2E)

## Global Constraints

- No new npm dependencies — use only the existing stack
- Follow Next.js App Router patterns: Server Components fetch data, Client Components handle interactivity
- Client-side Supabase writes use `createBrowserClient` from `@/lib/supabase-browser`
- Server-side Supabase reads use `createServerClient` from `@/lib/supabase-server`
- `tsc --noEmit` must pass after every task (run from `apps/web/`)
- All Tailwind classes must use existing design tokens: `bg-primary`, `text-primary`, `ring-primary`, `bg-sidebar-bg`, `dark:` variants
- E2E credentials are in `tests/e2e/.env.test` (git-ignored) — never hardcode passwords

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `deploy/supabase/schema.sql` | Add `first_name`, `last_name`, `username`, `phone` to `users` table |
| Create | `apps/web/lib/profile-actions.ts` | `saveProfile()` + `UserProfile` type |
| Create | `apps/web/components/ProfileForm.tsx` | Client Component — form state, save, status display |
| Create | `apps/web/app/(protected)/profile/page.tsx` | Server Component — fetch profile, lazy-init row |
| Modify | `tests/e2e/test_menu_navigation.py` | Add test 14: profile page navigation + edit + persistence |

---

### Task 1: DB Migration — add profile columns

**Files:**
- Modify: `deploy/supabase/schema.sql` (users table definition)
- Live DB: Supabase MCP `execute_sql`

**Interfaces:**
- Produces: `users` table with columns `first_name text`, `last_name text`, `username text`, `phone text`

- [✅] **Step 1: Update `schema.sql`**

  Replace the `users` table definition (find it by the `-- Tabella: users` comment):

  ```sql
  create table if not exists users (
    id         uuid        primary key references auth.users(id),
    name       text,
    email      text,
    avatar     text,
    role       text        not null default 'user',
    first_name text,
    last_name  text,
    username   text,
    phone      text,
    created_at timestamptz          default now(),
    updated_at timestamptz          default now()
  );
  ```

- [✅] **Step 2: Run migration on live DB via Supabase MCP**

  Use the `mcp__supabase__execute_sql` tool with this query:

  ```sql
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name text,
    ADD COLUMN IF NOT EXISTS last_name  text,
    ADD COLUMN IF NOT EXISTS username   text,
    ADD COLUMN IF NOT EXISTS phone      text;
  ```

- [✅] **Step 3: Verify columns exist**

  Use `mcp__supabase__execute_sql`:

  ```sql
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'users'
  ORDER BY ordinal_position;
  ```

  Expected output includes rows for `first_name`, `last_name`, `username`, `phone` with `data_type = 'text'`.

- [✅] **Step 4: Commit**

  ```bash
  git add deploy/supabase/schema.sql
  git commit -m "feat: add first_name, last_name, username, phone to users table"
  ```

---

### Task 2: `profile-actions.ts` — save helper + type

**Files:**
- Create: `apps/web/lib/profile-actions.ts`

**Interfaces:**
- Produces:
  - `UserProfile` — exported interface with `first_name`, `last_name`, `username`, `phone` (all `string | null`)
  - `saveProfile(profile: UserProfile): Promise<{ error: string | null }>` — exported async function

- [✅] **Step 1: Create `apps/web/lib/profile-actions.ts`**

  ```typescript
  'use client'

  import { createClient } from '@/lib/supabase-browser'

  export interface UserProfile {
    first_name: string | null
    last_name: string | null
    username: string | null
    phone: string | null
  }

  export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { error: authError?.message ?? 'Not authenticated' }

    const { error } = await supabase.from('users').upsert({
      id: user.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      username: profile.username,
      phone: profile.phone,
      updated_at: new Date().toISOString(),
    })

    return { error: error?.message ?? null }
  }
  ```

- [✅] **Step 2: TypeScript check**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: 0 errors.

- [✅] **Step 3: Commit**

  ```bash
  git add apps/web/lib/profile-actions.ts
  git commit -m "feat: add saveProfile() helper and UserProfile type"
  ```

---

### Task 3: `ProfileForm.tsx` — Client Component

**Files:**
- Create: `apps/web/components/ProfileForm.tsx`

**Interfaces:**
- Consumes:
  - `UserProfile` from `@/lib/profile-actions`
  - `saveProfile(profile: UserProfile): Promise<{ error: string | null }>` from `@/lib/profile-actions`
- Produces:
  - Default export `ProfileForm` — React Client Component
  - Props: `{ email: string; avatarUrl: string | null; initialProfile: UserProfile }`

- [✅] **Step 1: Create `apps/web/components/ProfileForm.tsx`**

  ```typescript
  'use client'

  import React, { useState } from 'react'
  import { CircleUser } from 'lucide-react'
  import { saveProfile, type UserProfile } from '@/lib/profile-actions'

  interface ProfileFormProps {
    email: string
    avatarUrl: string | null
    initialProfile: UserProfile
  }

  export default function ProfileForm({ email, avatarUrl, initialProfile }: ProfileFormProps) {
    const [profile, setProfile] = useState<UserProfile>(initialProfile)
    const [saving, setSaving] = useState(false)
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const handleChange = (field: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile(prev => ({ ...prev, [field]: e.target.value || null }))
    }

    const handleSave = async () => {
      setSaving(true)
      setStatus(null)
      const { error } = await saveProfile(profile)
      setSaving(false)
      if (error) {
        setStatus({ type: 'error', message: error })
      } else {
        setStatus({ type: 'success', message: 'Profile saved.' })
        setTimeout(() => setStatus(null), 3000)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm">

          {/* Avatar */}
          <div className="flex justify-center mb-6">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className="w-16 h-16 rounded-full ring-2 ring-primary/30"
              />
            ) : (
              <CircleUser size={64} className="text-gray-400 dark:text-gray-500" />
            )}
          </div>

          <div className="space-y-4">
            {/* Email — read-only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed text-sm"
              />
            </div>

            {/* First name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                First name
              </label>
              <input
                type="text"
                value={profile.first_name ?? ''}
                onChange={handleChange('first_name')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Last name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Last name
              </label>
              <input
                type="text"
                value={profile.last_name ?? ''}
                onChange={handleChange('last_name')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={profile.username ?? ''}
                onChange={handleChange('username')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Phone{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-6 py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>

          {/* Status message */}
          {status && (
            <p className={`mt-3 text-sm text-center ${
              status.type === 'success'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {status.type === 'success' ? '✓' : '✗'} {status.message}
            </p>
          )}

        </div>
      </div>
    )
  }
  ```

- [✅] **Step 2: TypeScript check**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: 0 errors.

- [✅] **Step 3: Commit**

  ```bash
  git add apps/web/components/ProfileForm.tsx
  git commit -m "feat: add ProfileForm client component"
  ```

---

### Task 4: `profile/page.tsx` — Server Component

**Files:**
- Create: `apps/web/app/(protected)/profile/page.tsx`

**Interfaces:**
- Consumes:
  - `createClient()` from `@/lib/supabase-server`
  - `ProfileForm` default export from `@/components/ProfileForm`
  - `UserProfile` from `@/lib/profile-actions`
- Produces: Next.js page at route `/profile`, accessible to authenticated users

- [✅] **Step 1: Create `apps/web/app/(protected)/profile/page.tsx`**

  ```typescript
  import { redirect } from 'next/navigation'
  import { createClient } from '@/lib/supabase-server'
  import ProfileForm from '@/components/ProfileForm'
  import type { UserProfile } from '@/lib/profile-actions'

  export default async function ProfilePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    // Lazy-init: create the users row if it doesn't exist yet
    await supabase
      .from('users')
      .upsert({ id: user.id, email: user.email }, { ignoreDuplicates: true })

    const { data: profile } = await supabase
      .from('users')
      .select('first_name, last_name, username, phone')
      .eq('id', user.id)
      .single()

    const initialProfile: UserProfile = {
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      username: profile?.username ?? null,
      phone: profile?.phone ?? null,
    }

    return (
      <ProfileForm
        email={user.email ?? ''}
        avatarUrl={user.user_metadata?.avatar_url ?? null}
        initialProfile={initialProfile}
      />
    )
  }
  ```

- [✅] **Step 2: TypeScript check**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: 0 errors.

- [✅] **Step 3: Start dev server and verify in browser**

  ```bash
  npm run web:dev
  ```

  - Open `http://localhost:3000/profile` (must be logged in)
  - Verify: avatar shown (or CircleUser icon), email field visible and not editable, four input fields present, "Save Profile" button present
  - Fill in "First name", click Save — verify "✓ Profile saved." appears
  - Reload page — verify the value persists

- [✅] **Step 4: Commit**

  ```bash
  git add apps/web/app/\(protected\)/profile/page.tsx
  git commit -m "feat: add /profile Server Component (fixes CRIT-2)"
  ```

---

### Task 5: E2E test — profile page

**Files:**
- Modify: `tests/e2e/test_menu_navigation.py` (add test 14, update summary count)

**Interfaces:**
- Consumes: running dev server at `BASE_URL`, authenticated session, `/profile` route from Task 4
- Produces: 8 new assertions (tests 14.1–14.8) in the existing test runner

- [✅] **Step 1: Add test 14 to `test_menu_navigation.py`**

  Insert the following block immediately before `browser.close()`:

  ```python
        # ── 14. Pagina Profile — navigazione, form, persistenza ──────────────
        print("\n── 14. Profile page — navigazione, form, persistenza ──")

        # Vai alla home e apri il pannello utente via sidebar
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        ensure_l1_expanded(page, l1)

        # Il bottone utente è l'ultimo button nella colonna L1
        # (contiene l'email dell'utente come testo)
        user_panel_btn = l1.locator(f"button:has-text('{TEST_EMAIL}')")
        user_panel_btn.click()
        page.wait_for_timeout(400)

        # Colonna L2 del pannello utente
        l2_user = page.locator("aside").nth(1)
        l2_user.get_by_text("Profile").click()
        try:
            page.wait_for_url("**/profile", timeout=5_000)
            record("Click 'Profile' naviga a /profile", True, page.url)
        except Exception:
            record("Click 'Profile' naviga a /profile", False, page.url)
        page.screenshot(path="/tmp/profile_01_page.png")

        # Campo email presente e non editabile
        email_input = page.locator('input[type="email"]')
        record("Campo email visibile su /profile", email_input.is_visible())
        record("Campo email è read-only (disabled)",
               not email_input.is_enabled())

        # Quattro campi editabili presenti (text + tel)
        editable = page.locator('input[type="text"], input[type="tel"]')
        record("Almeno 4 campi editabili presenti su /profile",
               editable.count() >= 4, f"{editable.count()} input trovati")

        # Compila first name e salva
        first_name_input = page.locator('input[type="text"]').first
        first_name_input.fill("E2E Test User")
        page.get_by_role("button", name="Save Profile").click()
        page.wait_for_timeout(1_000)
        page.screenshot(path="/tmp/profile_02_saved.png")

        record("Messaggio 'Profile saved.' appare dopo salvataggio",
               page.locator("text=Profile saved.").is_visible())

        # Verifica persistenza dopo reload
        page.reload()
        page.wait_for_load_state("networkidle")
        reloaded_value = page.locator('input[type="text"]').first.input_value()
        record("First name persiste dopo reload della pagina",
               reloaded_value == "E2E Test User",
               f"valore: '{reloaded_value}'")

        # Cleanup: svuota first name e salva
        page.locator('input[type="text"]').first.fill("")
        page.get_by_role("button", name="Save Profile").click()
        page.wait_for_timeout(1_000)
        record("Cleanup: first name svuotato e salvato",
               page.locator("text=Profile saved.").is_visible())
  ```

- [✅] **Step 2: Run the full E2E suite**

  ```bash
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "npm run web:dev" --port 3000 \
    -- python3 tests/e2e/test_menu_navigation.py
  ```

  Expected: all tests pass, including the 8 new assertions in section 14. Final line: `32/32 test superati` (or higher if earlier sections already had more).

- [✅] **Step 3: Commit**

  ```bash
  git add tests/e2e/test_menu_navigation.py
  git commit -m "test: add E2E test 14 for /profile page"
  ```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Avatar from IdP (read-only) — Task 3, `avatarUrl` prop, `<img>` or `<CircleUser>`
- ✅ Email read-only — Task 3, `disabled` input
- ✅ First name, Last name, Username, Phone — Task 2 (`UserProfile` type), Task 3 (form fields)
- ✅ Phone optional — Task 3, label "Phone (optional)"
- ✅ Explicit Save button — Task 3, `handleSave`
- ✅ Inline success/error — Task 3, `status` state
- ✅ DB migration — Task 1
- ✅ E2E test — Task 5
- ✅ No new dependencies — only existing imports used throughout

**Placeholder scan:** No TBD, TODO, or vague steps found.

**Type consistency:**
- `UserProfile` defined in Task 2, consumed in Task 3 (form state) and Task 4 (initialProfile prop)
- `saveProfile(profile: UserProfile): Promise<{ error: string | null }>` defined in Task 2, called in Task 3
- `ProfileForm` default export from Task 3, imported in Task 4
- `email: string`, `avatarUrl: string | null`, `initialProfile: UserProfile` — same prop names in Task 3 (definition) and Task 4 (call site)
