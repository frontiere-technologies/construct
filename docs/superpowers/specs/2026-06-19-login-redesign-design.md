# Login Redesign — Design Spec

**Date:** 2026-06-19
**Branch:** feature/oidc

## Overview

Redesign the login page to support two authentication methods:
1. Email + password for pre-created Construct users
2. Google OAuth restricted to allowed domains (stored in DB)

Includes a full "first login / set password" email flow via Resend, and a visual redesign matching the provided mockup.

---

## 1. Data Layer

### `users` table — new column
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
-- NULL until the user sets a password via invite flow
```

### New table: `password_set_tokens`
One-time tokens for the "set password" invite link.

```sql
CREATE TABLE IF NOT EXISTS password_set_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,  -- +48h from creation
  used_at     timestamptz,           -- set when consumed
  created_at  timestamptz DEFAULT now()
);
```

### New table: `allowed_domains`
Domains permitted for Google OAuth sign-in.

```sql
CREATE TABLE IF NOT EXISTS allowed_domains (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text        NOT NULL UNIQUE,  -- e.g. "frontiere.io"
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Seed
INSERT INTO allowed_domains (domain, active) VALUES ('frontiere.io', true)
ON CONFLICT (domain) DO NOTHING;
```

---

## 2. Auth.js Provider Changes (`apps/web/lib/auth.ts`)

### Credentials provider (production)
- ID: `credentials` (replaces test-only `test-credentials` for production use)
- Validates email + password against `users.password_hash` using bcrypt
- If `password_hash IS NULL` → throw `new CredentialsSignin("PasswordNotSet")` — Auth.js v5 surfaces this as `?error=PasswordNotSet` in the redirect URL, which the login component maps to the Italian message
- If email not found → generic error (prevents user enumeration)
- Returns `{ id, email, name, role }` on success
- The login form uses `signIn('credentials', { redirect: false })` to capture the error object before deciding whether to redirect or show an inline message

### Google provider — domain check
- In the `signIn` callback: query `allowed_domains` where `active = true`
- Cache result in-memory for 60s to avoid per-login DB round-trips
- If the Google account email domain is not in the allowed list → return `false` (triggers AccessDenied)
- On success → existing user provisioning in `users` runs normally

### Microsoft Entra ID / Keycloak providers
- Remain in `buildProviders()` gated by their respective env vars
- Not shown in the new login UI; no breaking change if vars are unset

### Test-credentials provider
- Retained, gated by `AUTH_TEST_CREDENTIALS=true`
- Hidden from the public UI; accessible via a collapsed "Accesso test" toggle when `NEXT_PUBLIC_AUTH_TEST_MODE=true`

---

## 3. Login UI (`apps/web/components/Login.tsx`)

### Layout
Two-tone card: dark header + white body + grey footer. Max width ~400px, centered on full-height grey background.

### Header (dark navy ~`#0f2336`)
- App name: "**Construct**" (large, bold, white)
- Subtitle: "Piattaforma — Frontiere Technologies" (small, muted)

### Body (white, generous padding)
1. Email input (label: "Email")
2. Password input (label: "Password") with show/hide eye toggle
3. "**Accedi**" primary button — full width, accent color (teal/navy border), loading state during submission
4. Error message in red (appears between password field and Accedi button when present)
5. Horizontal divider with "oppure" label
6. "**Continua con Google**" button — white background, grey border, inline SVG Google logo (multicolor), bold text

### Footer (light grey background, top border)
- Line 1: "Problemi di accesso? Contatta l'amministratore."
- Line 2: "Non hai un account? **Registrati**" — visually styled as a link, `href="#"` with `e.preventDefault()` (no registration flow implemented)

### Error messages (Italian)
| Code | Message |
|------|---------|
| `CredentialsSignin` | "Email o password non corretti." |
| `AccessDenied` | "Accesso negato. Non sei autorizzato ad accedere." |
| `PasswordNotSet` | "Imposta prima la tua password tramite il link ricevuto via email." |
| `Default` | "Si è verificato un errore durante l'accesso. Riprova." |

### Test mode
When `NEXT_PUBLIC_AUTH_TEST_MODE=true`: a small "Accesso test ▾" text link below the footer expands an inline form with an email-only field (existing test-credentials flow).

---

## 4. Set Password Flow

### Admin trigger
- Prerequisite: the user record must already exist in `users` (created by admin via direct DB insert or future admin UI — out of scope here)
- Server action: `sendInviteEmail(userId: string): Promise<void>`
- Creates a record in `password_set_tokens` (token = `crypto.randomUUID()`, `expires_at = now + 48h`)
- Sends email via Resend to the user's email address
- Exposed as `POST /api/admin/send-invite` — protected: requires `role === 'admin'` in session
- Request body: `{ userId: string }`

### Email (Resend)
- From: `RESEND_FROM` env var (e.g. `noreply@frontiere.io`)
- Subject: "Benvenuto in Construct — Imposta la tua password"
- Body: plain text + HTML with a single CTA button linking to `/set-password?token=<uuid>`
- Token expires in 48 hours; email notes this

### Page `/set-password`
1. Read `?token` from search params
2. Server-side: validate token (exists, `used_at IS NULL`, `expires_at > now()`) → if invalid, render error page with "Link non valido o scaduto. Contatta l'amministratore."
3. Render form: "Nuova password" + "Conferma password"
   - Client-side validation: min 8 chars, passwords match
4. On submit → `POST /api/auth/set-password`:
   - Re-validate token (server-side again)
   - `bcrypt.hash(password, 10)` → update `users.password_hash`
   - Set `password_set_tokens.used_at = now()`
   - Return 200
5. Redirect to `/login?message=password-set`
6. `/login` detects `?message=password-set` → shows green banner "Password impostata con successo. Puoi accedere."

---

## 5. New Environment Variables

```env
RESEND_API_KEY=re_...         # Resend API key
RESEND_FROM=noreply@frontiere.io  # Sender address
```

---

## 6. New Dependencies

```bash
npm install resend bcryptjs
npm install -D @types/bcryptjs
```

---

## 7. Out of Scope

- Self-service registration (Registrati link is a visual placeholder only)
- Password change / forgot password flow (separate future spec)
- Admin UI for user management (admin triggers invites via API endpoint for now)
- Microsoft Entra ID / Keycloak UI buttons (providers remain configured but hidden)
