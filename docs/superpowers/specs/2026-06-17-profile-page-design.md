# Profile Page — Design Spec

**Date:** 2026-06-17
**Branch:** feature/small-fixes
**Fixes:** CRIT-2 (broken `/profile` link in Sidebar)

---

## Goal

Create a `/profile` page where authenticated users can view and edit their profile data. Closes the broken link that exists in the sidebar user panel.

---

## Scope

In scope:
- Display avatar from IdP (read-only)
- Display email (read-only)
- Edit: first name, last name, username, phone (optional)
- Single explicit Save button
- Inline success/error feedback (no toast library)
- DB migration to add new columns to `users` table
- E2E Playwright test

Out of scope:
- Custom avatar upload
- Password change
- Account deletion
- Email change

---

## Architecture

### Files to create

| File | Type | Responsibility |
|------|------|----------------|
| `apps/web/app/(protected)/profile/page.tsx` | Server Component | Fetch profile from Supabase, pass as props |
| `apps/web/components/ProfileForm.tsx` | Client Component | Editable form, local state, save action |
| `apps/web/lib/profile-actions.ts` | Client helper | `saveProfile()` — upsert to `users` table |

### Files to modify

| File | Change |
|------|--------|
| `deploy/supabase/schema.sql` | Add `first_name`, `last_name`, `username`, `phone` to `users` table |
| Supabase DB (live, via MCP) | `ALTER TABLE users ADD COLUMN IF NOT EXISTS ...` |

### Pattern

Follows the existing pattern used in `app/(protected)/layout.tsx`:
- Server Component fetches data server-side using `createServerClient`
- Passes data as props to a Client Component for interactivity
- Client-side write helper in `lib/` (same as `menu-actions.ts`)

---

## Database Schema

### Migration

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS username   text,
  ADD COLUMN IF NOT EXISTS phone      text;
```

Applied to both `deploy/supabase/schema.sql` (source of truth) and the live DB via Supabase MCP `execute_sql`.

### Existing `users` table (unchanged columns)

```sql
create table if not exists users (
  id         uuid  primary key references auth.users(id),
  name       text,        -- kept as-is, not touched
  email      text,
  avatar     text,
  role       text not null default 'user',
  created_at timestamptz  default now(),
  updated_at timestamptz  default now()
);
```

The existing `name` column is left untouched. No migration removes it (out of scope).

---

## Data Flow

1. `profile/page.tsx` (Server Component):
   - Calls `createClient().auth.getUser()` to get the authenticated user
   - Queries `users` table: `SELECT * FROM users WHERE id = auth.uid()`
   - If no row exists: upserts `{ id, email }` (lazy init, same pattern as menu seed)
   - Reads `avatarUrl` from `user.user_metadata?.avatar_url`
   - Passes `{ email, avatarUrl, first_name, last_name, username, phone }` as props to `ProfileForm`

2. `ProfileForm` (Client Component):
   - Receives initial values as props
   - Manages local form state for the four editable fields
   - On "Save Profile" click: calls `saveProfile()` from `profile-actions.ts`
   - On success: shows inline "Saved" message (green, disappears after 3 seconds)
   - On error: shows inline error message (red, stays until next save attempt)

3. `saveProfile()` in `lib/profile-actions.ts`:
   - Uses `createBrowserClient` (same as `menu-actions.ts`)
   - Calls `supabase.auth.getUser()` internally to obtain the authenticated user's `id` — no `userId` prop needed on `ProfileForm`
   - Calls `supabase.from('users').upsert({ id, first_name, last_name, username, phone, updated_at: new Date().toISOString() })`
   - Returns `{ error }` — no redirect

---

## Form Fields

| Field | Source | Editable | Required | Notes |
|-------|--------|----------|----------|-------|
| Avatar | `user_metadata.avatar_url` | No | — | `<img>` if present, `<CircleUser>` fallback |
| Email | `auth.users.email` | No | — | Input `disabled`, visually distinct (muted) |
| First name | `users.first_name` | Yes | No | |
| Last name | `users.last_name` | Yes | No | |
| Username | `users.username` | Yes | No | Not unique — display label only |
| Phone | `users.phone` | Yes | No | Labeled "Phone (optional)" |

---

## UI Layout

Single centered card, consistent with the Login page style (Tailwind, no new dependencies):

```
┌──────────────────────────────────────┐
│                                      │
│         [  avatar 64×64px  ]         │
│                                      │
│  Email                               │
│  [mario@example.com          ] (dim) │
│                                      │
│  First name                          │
│  [                           ]       │
│                                      │
│  Last name                           │
│  [                           ]       │
│                                      │
│  Username                            │
│  [                           ]       │
│                                      │
│  Phone (optional)                    │
│  [                           ]       │
│                                      │
│            [ Save Profile ]          │
│                                      │
│  ✓ Profile saved.   /  ✗ Error msg  │
└──────────────────────────────────────┘
```

Card is `max-w-sm`, centered with `mx-auto mt-8 px-4`. Avatar centered above fields. Read-only email uses `opacity-50 cursor-not-allowed`. Save button uses `bg-primary text-white`.

---

## Error Handling

- **No client-side validation required**: all editable fields are optional (phone is explicitly optional, others have no format constraint).
- **Save errors**: displayed as inline red text below the Save button. Message stays until the next save attempt.
- **Save success**: inline green "Profile saved." text, auto-clears after 3 seconds via `setTimeout`.
- **Network/auth errors**: surfaced from the Supabase client response `error.message`.

---

## E2E Test

New test added to `tests/e2e/test_menu_navigation.py` as test 14:

1. Navigate to `/profile` via user panel link in sidebar
2. Verify page loads at `/profile`
3. Verify email field is present and disabled
4. Verify the four editable fields are present
5. Fill "First name" with `"E2E Test User"`, click "Save Profile"
6. Verify success message appears
7. Reload page, verify "First name" still shows `"E2E Test User"`
8. Cleanup: clear "First name", save again

---

## Constraints and Decisions

- **No new dependencies**: uses only existing stack (React, Supabase, Tailwind, Lucide)
- **Avatar is read-only**: value comes from IdP `user_metadata.avatar_url`. No storage in `users.avatar` column (that column exists but is not used here — out of scope)
- **Username is not unique**: primary key is the IdP `id`. Username is a free-form display label
- **`name` column untouched**: the existing `name` field in `users` is not mapped to any form field — left as-is
- **`updated_at` updated on save**: included in the upsert payload
