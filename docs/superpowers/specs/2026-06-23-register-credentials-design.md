# Design: Self-Registration via Credentials

**Date:** 2026-06-23
**Status:** Approved

## Overview

Implement the "Registrati" self-registration flow for credentials-based users. The user enters their email; if the domain is in the allow-list and the email is not already registered, they receive a set-password link to complete registration.

## Scope

- New API route: `POST /api/auth/register`
- UI extension: inline form in `Login.tsx` (same pattern as `forgotMode`)

## API — `POST /api/auth/register`

**File:** `apps/web/app/api/auth/register/route.ts`

**Input:** `{ email: string }`

**Logic:**
1. Validate `email` presence and type
2. Query `allowed_domains` where `active = true`; extract domain from email and check membership
3. If domain not allowed → return `{ ok: true }` silently (no info leak)
4. Query `users` for existing row with that email
5. If email already exists → return `{ ok: true }` silently (no info leak)
6. Insert new user: `{ email: email.toLowerCase().trim(), role: 'user', auth_provider: 'credentials' }`
7. Insert token in `password_set_tokens`: `{ user_id, token: crypto.randomUUID(), expires_at: +48h }`
8. Send email via `sendEmail()` — same template as `send-invite` ("Benvenuto, imposta la tua password")
9. Return `{ ok: true }` always

**Auth:** public route (no session required — user is not yet logged in)

**Error handling:** any internal error (DB, email) is logged server-side; client always receives `{ ok: true }` to avoid leaking state.

## UI — `Login.tsx`

**New state:**
```ts
const [registerMode, setRegisterMode] = useState(false)
const [registerEmail, setRegisterEmail] = useState('')
const [registerStatus, setRegisterStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
```

**Behaviour:**
- Click "Registrati" → `setRegisterMode(true)`, `setForgotMode(false)`, reset register state
- The inline form renders in the footer section (same position as `forgotMode`)
- `registerMode` and `forgotMode` are mutually exclusive
- On submit: `POST /api/auth/register` with `{ email: registerEmail }`
- On `sent`: show green confirmation — *"Se l'email è autorizzata riceverai un link per completare la registrazione."*
- On `error`: show red message — *"Errore. Riprova tra qualche istante."*
- "Annulla" → `setRegisterMode(false)`

**No new page, no new component.** All changes are within `LoginForm` in `Login.tsx`.

## Data Flow

```
User clicks "Registrati"
  → registerMode = true (inline form appears)
  → User enters email, submits
  → POST /api/auth/register
      → domain check (allowed_domains)
      → duplicate check (users)
      → INSERT users (role=user, auth_provider=credentials)
      → INSERT password_set_tokens (48h)
      → sendEmail() → set-password link
  → { ok: true }
  → UI shows confirmation message
  → User clicks link in email → /set-password?token=...
  → Existing set-password flow handles the rest
```

## What Is Not Changing

- `/set-password` page — unchanged, already handles token-based password setup
- `send-invite` route — unchanged, still used for admin-initiated invites
- `allowed_domains` table — unchanged, reused as-is
- `password_set_tokens` table — unchanged

## Security Notes

- Domain restriction prevents arbitrary signups
- Silent `{ ok: true }` for all failure cases prevents user enumeration
- Token expires in 48h
- No password is ever transmitted — user sets it via the signed link
