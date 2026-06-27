# Design: OIDC/Auth Finalize — Structured Logging + Password Policy

Date: 2026-06-25  
Branch: `feature/finalize-oidc`  
Status: Approved

## Objective

Bring the `feature/finalize-oidc` branch to production readiness by resolving the two open findings from the 2026-06-24 code review:

- **IMP-1** — Recipient email (PII) logged unconditionally at INFO level
- **MIN-2** — `console.log`/`console.error` instead of structured logging

And adding the one missing server-side safeguard:

- **Password policy** — validation currently exists only client-side

## Out of Scope

- Rate limiting (delegated to infrastructure: Vercel initially, then AWS WAF/API Gateway)
- MFA, audit logging, token revocation, token refresh
- Email templates refactor

## Architecture

Two new shared files under `sources/microservices/web-construct/lib/`:

```
lib/
  logger.ts        — pino base instance with redact, exports createLogger()
  validations.ts   — reusable Zod schemas (passwordSchema, emailSchema)
```

No new endpoints, no new Supabase tables, no structural changes to existing files.

**New dependency:** `pino` (production). Optionally `pino-pretty` (dev only, for human-readable terminal output).

## Section 1: Structured Logging (`lib/logger.ts`)

### Implementation

```typescript
// lib/logger.ts
import pino from 'pino'

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['email', 'to', 'password', 'password_hash', 'token'],
  base: { service: 'web-construct' },
})

export function createLogger(module: string) {
  return base.child({ module })
}
```

### Usage pattern in each module

```typescript
const log = createLogger('mailer')
log.info({ to, provider: 'resend', messageId: data.id }, 'email sent')
// JSON output: { service: 'web-construct', module: 'mailer', to: '[Redacted]', messageId: 'abc123', msg: 'email sent' }
```

### How it resolves the findings

- **IMP-1 (PII):** `redact: ['email', 'to', 'password', 'password_hash', 'token']` — pino automatically replaces these fields with `[Redacted]` in all log output. No manual masking logic needed.
- **MIN-2 (structured logging):** JSON output is filterable by `module`, `level`, and any structured field. INFO-level success logs are preserved but now carry context instead of free-form strings.

### Error logging pattern

```typescript
// before
console.error('[mailer] resend error:', JSON.stringify(error))

// after
log.error({ err: error }, 'resend send failed')
```

pino serializes `err` automatically including stack trace — no information loss compared to `JSON.stringify`.

### Files modified

| File | Change |
|------|--------|
| `lib/mailer.ts` | Replace `console.log`/`console.error` with child logger `mailer` |
| `lib/auth.ts` | Replace any `console.*` calls with child logger `auth` |
| `app/api/auth/register/route.ts` | Replace with child logger `auth:register` |
| `app/api/auth/forgot-password/route.ts` | Replace with child logger `auth:forgot-password` |
| `app/api/auth/set-password/route.ts` | Replace with child logger `auth:set-password` |
| `app/api/auth/change-password/route.ts` | Replace with child logger `auth:change-password` |
| `app/api/admin/send-invite/route.ts` | Replace with child logger `admin:send-invite` |

### Environment variable

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOG_LEVEL` | `info` | Controls pino log level (debug/info/warn/error) |

Add `LOG_LEVEL=info` to `.env.template` (production-safe default); comment that `debug` can be set locally for verbose diagnostics.

## Section 2: Password Policy (`lib/validations.ts`)

### Implementation

```typescript
// lib/validations.ts
import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'Minimo 8 caratteri')
  .regex(/[A-Z]/, 'Almeno una lettera maiuscola')
  .regex(/[0-9]/, 'Almeno un numero')

export const emailSchema = z
  .string()
  .email('Email non valida')
  .toLowerCase()
  .trim()
```

### Where it is applied

| Endpoint | Field validated |
|----------|----------------|
| `app/api/auth/set-password/route.ts` | `password` (before bcrypt hash) |
| `app/api/auth/change-password/route.ts` | `newPassword` (before bcrypt hash) |

### Error response (400)

```json
{ "error": "La password deve contenere almeno una lettera maiuscola e un numero" }
```

The Zod `.flatten()` or `.issues[0].message` is used to extract a human-readable Italian error message.

### Frontend alignment

`SetPasswordForm.tsx` already validates client-side with the same constraints (min 8 chars; the regex rules are added to the form validation in sync with this change). Users will never see an unexpected server-side rejection if the frontend is used normally.

### Note on emailSchema

`emailSchema` replaces the manual `.toLowerCase().trim()` pattern already present in register and forgot-password routes — a DRY improvement with no behavior change.

## Section 3: Error Handling

No changes to error flow. The logger replaces `console.error` while preserving the same throw/return pattern:

```typescript
// set-password/route.ts — before
console.error('[set-password] error:', error)
return NextResponse.json({ error: 'Errore interno' }, { status: 500 })

// after
log.error({ err: error }, 'set password failed')
return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
```

## Section 4: Testing

No new tests required.

- **Logging changes** alter output format only, not behavior → existing E2E tests pass unchanged.
- **Password policy** — existing E2E tests already use compliant passwords (e.g. `Test1234!`). No test needs updating.

**Manual verification after deploy to dev:**
1. Trigger a registration email and confirm `to: '[Redacted]'` appears in logs instead of the raw email address.
2. Attempt set-password with `password: 'alllower1'` (no uppercase) → expect 400 with Italian error message.
3. Attempt set-password with `password: 'NoNumbers'` → expect 400 with Italian error message.
4. Attempt set-password with `password: 'Valid1pass'` → expect 200.

## Implementation Order

1. Add `pino` to package.json
2. Create `lib/logger.ts`
3. Create `lib/validations.ts`
4. Update `lib/mailer.ts` — logger + redact resolves IMP-1
5. Update auth API routes — logger replaces console.* resolves MIN-2
6. Add `passwordSchema` validation to set-password and change-password routes
7. Align `SetPasswordForm.tsx` client-side validation with new policy
8. Add `LOG_LEVEL` to `.env.template`
9. Manual verification per checklist above
10. Update review file checkboxes: mark IMP-1 and MIN-2 as resolved
