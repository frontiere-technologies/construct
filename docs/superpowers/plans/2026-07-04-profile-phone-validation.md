# Profile Phone Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [✅]`) syntax for tracking.

**Goal:** Validate the profile Phone field against E.164 format server-side, while keeping the field optional.

**Architecture:** Add a `phoneSchema` zod schema to `lib/validations.ts` (same pattern as `emailSchema`/`passwordSchema`), consume it inside the existing `saveProfile()` server action in `lib/profile-actions.ts` with a `safeParse()` guard that only runs when a value is present, and add a format-hint `placeholder` to the Phone `<input>` in `ProfileForm.tsx`. No client-side validation, no DB constraint — matches how email/password are already handled in this codebase.

**Tech Stack:** Next.js 15 (App Router) server actions, zod, Playwright via `pytest` (Python, run with `uv run pytest`).

## Global Constraints

- E.164 format required when Phone has a value: regex `^\+[1-9]\d{1,14}$` (from spec).
- Empty string / `null` Phone must always pass validation (field stays optional).
- Error messages in Italian, matching existing `passwordSchema`/`emailSchema` messages.
- No client-side (onChange/onBlur) validation — no other field in `ProfileForm.tsx` has it.
- No DB-level `CHECK` constraint.
- Tests are Python/Playwright e2e only (no JS unit test runner exists in this repo) — run via `uv run pytest sources/tests/e2e/test_profile.py`.

---

### Task 1: Add `phoneSchema` and wire it into `saveProfile`, with e2e coverage

**Files:**
- Modify: `sources/microservices/web-construct/lib/validations.ts`
- Modify: `sources/microservices/web-construct/lib/profile-actions.ts:13-28`
- Modify: `sources/microservices/web-construct/components/ProfileForm.tsx:123-128`
- Test: `sources/tests/e2e/test_profile.py`

**Interfaces:**
- Consumes: nothing new from other tasks (this is the only task).
- Produces: `phoneSchema` (exported `ZodString`) in `lib/validations.ts`, consumed by `saveProfile()` in `lib/profile-actions.ts`. `saveProfile()`'s signature and `{ error: string | null }` return type are unchanged.

- [✅] **Step 1: Write the failing e2e tests**

Append to `sources/tests/e2e/test_profile.py`:

```python
def test_profile_phone_rejects_invalid_format(profile_page):
    page = profile_page

    phone_input = page.locator('input[type="tel"]')
    phone_input.fill("123")
    page.get_by_role("button", name="Save Profile").click()
    page.locator("text=Numero di telefono non valido").wait_for(state="visible", timeout=10_000)

    # Cleanup: field is unsaved, but clear the input for test isolation
    phone_input.fill("")


def test_profile_phone_accepts_e164_format(profile_page):
    page = profile_page

    phone_input = page.locator('input[type="tel"]')
    phone_input.fill("+14155552671")
    page.get_by_role("button", name="Save Profile").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded_value = page.locator('input[type="tel"]').input_value()
    assert reloaded_value == "+14155552671", f"Value not persisted after reload: '{reloaded_value}'"

    # Cleanup
    page.locator('input[type="tel"]').fill("")
    page.get_by_role("button", name="Save Profile").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)
```

- [✅] **Step 2: Run tests to verify they fail**

Run: `uv run pytest sources/tests/e2e/test_profile.py -v -k phone`

Expected: `test_profile_phone_rejects_invalid_format` FAILS (no "Numero di telefono non valido" text ever appears — the current code saves "123" without validation, so the input times out waiting for that text). `test_profile_phone_accepts_e164_format` PASSES already (no validation exists yet, so this establishes the baseline before checking it still passes after implementation).

- [✅] **Step 3: Add `phoneSchema` to `lib/validations.ts`**

Current content of `sources/microservices/web-construct/lib/validations.ts`:

```ts
import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'La password deve contenere almeno 8 caratteri.')
  .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola.')
  .regex(/[0-9]/, 'La password deve contenere almeno un numero.')

export const emailSchema = z.string().email('Email non valida.').toLowerCase().trim()
```

Append:

```ts

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'Numero di telefono non valido. Usa il formato internazionale, es. +391234567890.')
```

- [✅] **Step 4: Integrate `phoneSchema` into `saveProfile()`**

In `sources/microservices/web-construct/lib/profile-actions.ts`, current content:

```ts
'use server'

import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  const supabase = createAdminClient()
  const { error } = await supabase.from('users').upsert({
    id: session.user.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    phone: profile.phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  return { error: error?.message ?? null }
}
```

Replace with:

```ts
'use server'

import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { phoneSchema } from '@/lib/validations'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  if (profile.phone) {
    const parsed = phoneSchema.safeParse(profile.phone)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('users').upsert({
    id: session.user.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    phone: profile.phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  return { error: error?.message ?? null }
}
```

- [✅] **Step 5: Add format-hint placeholder to the Phone input**

In `sources/microservices/web-construct/components/ProfileForm.tsx`, current Phone block (lines 117-129):

```tsx
            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Phone{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
```

Replace with:

```tsx
            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Phone{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="tel"
                value={profile.phone ?? ''}
                onChange={handleChange('phone')}
                placeholder="+391234567890"
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface-overlay text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
```

- [✅] **Step 6: Run lint**

Run: `cd sources/microservices/web-construct && npm run lint`

Expected: no new errors.

- [✅] **Step 7: Run the e2e tests to verify they pass**

Run: `uv run pytest sources/tests/e2e/test_profile.py -v -k phone`

Expected: both `test_profile_phone_rejects_invalid_format` and `test_profile_phone_accepts_e164_format` PASS.

- [✅] **Step 8: Run the full profile test file to check for regressions**

Run: `uv run pytest sources/tests/e2e/test_profile.py -v`

Expected: all tests PASS (including the pre-existing `test_profile_save_and_persist`, `test_profile_has_editable_fields`, etc.).

- [✅] **Step 9: Commit**

```bash
git add sources/microservices/web-construct/lib/validations.ts \
        sources/microservices/web-construct/lib/profile-actions.ts \
        sources/microservices/web-construct/components/ProfileForm.tsx \
        sources/tests/e2e/test_profile.py
git commit -m "feat(profile): validate Phone field against E.164 format"
```
