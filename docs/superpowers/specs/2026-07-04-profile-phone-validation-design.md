# Profile Phone Validation — Design

## Problem

The Phone field in the user profile (`ProfileForm.tsx`) accepts any free-text
input with no format validation, either client-side or server-side. The DB
column (`users.phone`, `text`) has no constraint either. This lets users save
malformed phone numbers.

## Goals

- Validate the Phone field format when a value is provided.
- Keep the field optional: empty/null must remain valid (no value required).
- Follow the existing validation pattern in the codebase (`zod` schema in
  `lib/validations.ts`, consumed via `safeParse()`).

## Format

International E.164 format is required when a value is present, e.g.
`+14155552671`, `+391234567890`. No spaces, dashes, or parentheses.

Regex: `^\+[1-9]\d{1,14}$`

## Changes

### 1. `lib/validations.ts`

Add a new schema next to `emailSchema`/`passwordSchema`:

```ts
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'Numero di telefono non valido. Usa il formato internazionale, es. +391234567890.')
```

### 2. `lib/profile-actions.ts` — `saveProfile()`

Before the Supabase upsert, validate `profile.phone` only if it is truthy
(non-empty). Empty string / `null` bypass validation entirely:

```ts
if (profile.phone) {
  const parsed = phoneSchema.safeParse(profile.phone)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
}
```

This returns the same `{ error: string | null }` shape `saveProfile` already
uses, so `ProfileForm.tsx` needs no logic changes — the error surfaces via the
existing `status` state/message, consistent with how Supabase errors are
already displayed today.

### 3. `components/ProfileForm.tsx`

Add `placeholder="+391234567890"` to the Phone `<input>` to hint the expected
format, since E.164 is stricter than typical free-form phone entry. No other
changes.

### 4. Tests

Extend `sources/tests/e2e/test_profile.py` with two cases:
- Valid E.164 number (e.g. `+14155552671`) saves successfully.
- Invalid number (e.g. `123`) shows the validation error message and the
  profile is not saved.

## Non-goals

- No client-side (onChange/onBlur) validation — no other field in this form
  has it, so server-side-only keeps the pattern consistent.
- No DB-level `CHECK` constraint — validation lives in the application layer,
  matching how email/password are handled.
- No phone number normalization/formatting beyond `trim()`.
