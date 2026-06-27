# OIDC/Auth Finalize — Structured Logging + Password Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `feature/finalize-oidc` to production readiness by migrating all auth `console.*` calls to structured pino logging with automatic PII redaction, and enforcing password complexity policy server-side.

**Architecture:** Two new shared lib files (`logger.ts`, `validations.ts`) serve all auth modules. Pino's `redact` option auto-masks PII fields (`email`, `to`, `token`, `password`, `password_hash`) in every log line. Child loggers per module make logs filterable by source. Password policy (min 8 chars + uppercase + digit) is enforced via Zod in set-password and change-password routes and reflected in the frontend form.

**Tech Stack:** Next.js 15 (App Router), TypeScript, pino (new), pino-pretty (dev only), Zod ^4 (already installed), NextAuth v5, Supabase

## Global Constraints

- All file paths below are relative to `sources/microservices/web-construct/` unless otherwise noted
- Use `npm install` when adding dependencies (not `yarn` or `pnpm`)
- All user-facing error messages stay in Italian — do not change existing Italian strings
- `lib/logger.ts` is server-only — never import it in client components or pages
- Run `npm run build` after each task to catch TypeScript errors before committing
- Commits are made from the repo root (`/Users/mario.stefanutti/mario/programming/github-frontiere/construct`)

---

### Task 1: Add pino + create lib/logger.ts

**Files:**
- Modify: `package.json` (pino added by npm install)
- Modify: `next.config.ts` (add `serverExternalPackages` to prevent bundling issues)
- Create: `lib/logger.ts`

**Interfaces:**
- Produces: `createLogger(module: string): pino.Logger` — child logger factory consumed by all subsequent tasks

- [x] **Step 1: Install pino**

```bash
cd sources/microservices/web-construct
npm install pino
npm install --save-dev pino-pretty
```

Expected: `package.json` and `package-lock.json` updated.

- [x] **Step 2: Add serverExternalPackages to next.config.ts**

Replace the full content of `next.config.ts` with:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['pino', 'pino-pretty'],
  devIndicators: {
    position: 'bottom-right',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
```

- [x] **Step 3: Create lib/logger.ts**

```typescript
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

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [x] **Step 5: Commit**

```bash
git add \
  sources/microservices/web-construct/lib/logger.ts \
  sources/microservices/web-construct/package.json \
  sources/microservices/web-construct/package-lock.json \
  sources/microservices/web-construct/next.config.ts
git commit -m "feat(logging): add pino logger with PII redaction"
```

---

### Task 2: Create lib/validations.ts

**Files:**
- Create: `lib/validations.ts`

**Interfaces:**
- Produces: `passwordSchema: ZodString` — consumed by set-password and change-password routes in Task 4
- Produces: `emailSchema: ZodString` — available for future use

- [x] **Step 1: Create lib/validations.ts**

```typescript
import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'La password deve contenere almeno 8 caratteri.')
  .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola.')
  .regex(/[0-9]/, 'La password deve contenere almeno un numero.')

export const emailSchema = z.string().email('Email non valida.').toLowerCase().trim()
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add sources/microservices/web-construct/lib/validations.ts
git commit -m "feat(auth): add Zod password and email validation schemas"
```

---

### Task 3: Migrate lib/mailer.ts to pino (resolves IMP-1)

**Files:**
- Modify: `lib/mailer.ts`

**Interfaces:**
- Consumes: `createLogger` from `@/lib/logger`

- [x] **Step 1: Replace lib/mailer.ts**

```typescript
import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('mailer')

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<void> {
  const provider = process.env.MAIL_PROVIDER ?? 'resend'

  if (provider === 'smtp') {
    const from = process.env.SMTP_FROM ?? process.env.RESEND_FROM ?? 'noreply@frontiere.io'
    log.info({ provider: 'smtp', to, from, subject }, 'sending email')
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
    const info = await transporter.sendMail({ from, to, subject, html, text })
    log.info({ provider: 'smtp', messageId: info.messageId }, 'email sent')
    return
  }

  // Default: Resend
  const from = process.env.RESEND_FROM ?? 'noreply@frontiere.io'
  log.info({ provider: 'resend', to, from, subject }, 'sending email')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({ from, to, subject, html, text })
  if (error) {
    log.error({ err: error, provider: 'resend' }, 'email send failed')
    throw new Error(`Resend error: ${error.message}`)
  }
  log.info({ provider: 'resend', id: data?.id }, 'email sent')
}
```

Note: `to` is passed in the log object but pino's `redact: ['to']` config replaces it with `[Redacted]` automatically — IMP-1 resolved without any manual masking.

- [x] **Step 2: Verify build**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add sources/microservices/web-construct/lib/mailer.ts
git commit -m "fix(logging): migrate mailer to pino, auto-redact recipient PII (IMP-1)"
```

---

### Task 4: Migrate lib/auth.ts to pino

**Files:**
- Modify: `lib/auth.ts` (2 `console.error` calls)

**Interfaces:**
- Consumes: `createLogger` from `@/lib/logger`

- [x] **Step 1: Add logger import and instance at the top of lib/auth.ts**

After the existing imports (before the first `const` or `let` declaration at module level), add:

```typescript
import { createLogger } from '@/lib/logger'

const log = createLogger('auth')
```

- [x] **Step 2: Replace the allowed-domains fetch error (search for `Failed to retrieve allowed domains`)**

Before:
```typescript
console.error('[auth] Failed to retrieve allowed domains:', error)
```

After:
```typescript
log.error({ err: error }, 'failed to retrieve allowed domains')
```

- [x] **Step 3: Replace the Supabase user provisioning error (search for `Failed to provision user`)**

Before:
```typescript
console.error('[auth] Failed to provision user in Supabase:', err)
```

After:
```typescript
log.error({ err }, 'failed to provision user in Supabase')
```

- [x] **Step 4: Verify build**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/auth.ts
git commit -m "fix(logging): migrate auth.ts to pino structured logging"
```

---

### Task 5: Migrate register, forgot-password, and admin send-invite routes

These three routes only need logger migration (no schema changes).

**Files:**
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/forgot-password/route.ts`
- Modify: `app/api/admin/send-invite/route.ts`

**Interfaces:**
- Consumes: `createLogger` from `@/lib/logger`

#### register/route.ts

- [x] **Step 1: Replace app/api/auth/register/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:register')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const domain = normalizedEmail.split('@')[1] ?? ''

  const supabase = createAdminClient()

  // Domain allow-list check
  const { data: domainRow } = await supabase
    .from('allowed_domains')
    .select('id')
    .eq('domain', domain)
    .eq('active', true)
    .maybeSingle()
  if (!domainRow) {
    return NextResponse.json({ ok: true })
  }

  // Duplicate email check
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (existing?.id) {
    return NextResponse.json({ ok: true })
  }

  // Create user
  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({ email: normalizedEmail, role: 'user', auth_provider: 'credentials' })
    .select('id')
    .single()
  if (insertError || !newUser?.id) {
    log.error({ err: insertError }, 'failed to create user')
    return NextResponse.json({ ok: true })
  }

  // Create set-password token (48h)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { error: tokenError } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: newUser.id, token, expires_at: expiresAt })
  if (tokenError) {
    log.error({ err: tokenError }, 'failed to create password token')
    await supabase.from('users').delete().eq('id', newUser.id)
    return NextResponse.json({ ok: true })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send welcome email')
  }

  return NextResponse.json({ ok: true })
}
```

#### forgot-password/route.ts

- [x] **Step 2: Replace app/api/auth/forgot-password/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:forgot-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', email.toLowerCase().trim())
    .single()

  // Always return 200 — do not leak whether the email exists
  // Only issue reset tokens for credentials users (those with a password_hash)
  if (!user?.id || !user.password_hash) return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

  const { error: insertErr } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: user.id, token, expires_at: expiresAt })

  if (insertErr) {
    log.error({ err: insertErr }, 'failed to create reset token')
    return NextResponse.json({ ok: true })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reimposta la tua password — Construct',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Reimposta la tua password</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Hai richiesto il reset della password. Clicca sul pulsante qui sotto per impostarne una nuova.
            Il link è valido per 2 ore.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Reimposta la password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non hai richiesto il reset, ignora questa email. La tua password non verrà modificata.
          </p>
        </div>
      `,
      text: `Hai richiesto il reset della password su Construct.\n\nReimposta la tua password al seguente link (valido 2 ore):\n${resetUrl}\n\nSe non hai richiesto il reset, ignora questa email.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send reset email')
  }

  return NextResponse.json({ ok: true })
}
```

#### admin/send-invite/route.ts

- [x] **Step 3: Replace app/api/admin/send-invite/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, name')
    .eq('id', userId)
    .single()

  if (!user?.email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const { error: insertErr } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: user.id, token, expires_at: expiresAt })

  if (insertErr) {
    log.error({ err: insertErr }, 'failed to create invite token')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ error: 'Errore di configurazione del server.' }, { status: 500 })
  }
  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: user.email,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send invite email')
    return NextResponse.json({ error: 'Errore invio email.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [x] **Step 4: Verify build**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 5: Commit**

```bash
git add \
  sources/microservices/web-construct/app/api/auth/register/route.ts \
  sources/microservices/web-construct/app/api/auth/forgot-password/route.ts \
  sources/microservices/web-construct/app/api/admin/send-invite/route.ts
git commit -m "fix(logging): migrate register, forgot-password, send-invite to pino"
```

---

### Task 6: Migrate set-password + change-password routes (logger + password policy)

These two routes get both the logger migration and the `passwordSchema` enforcement in a single atomic task.

**Files:**
- Modify: `app/api/auth/set-password/route.ts`
- Modify: `app/api/auth/change-password/route.ts`

**Interfaces:**
- Consumes: `createLogger` from `@/lib/logger`
- Consumes: `passwordSchema` from `@/lib/validations`

#### set-password/route.ts

- [x] **Step 1: Replace app/api/auth/set-password/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase-server'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'

const log = createLogger('auth:set-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { token, password } = body ?? {}

  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Parametri mancanti.' }, { status: 400 })
  }

  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: tokenRow } = await supabase
    .from('password_set_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token', token)
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
  }
  if (tokenRow.used_at) {
    return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
  }

  const hash = await bcrypt.hash(password, 12)

  // Update password first — if this fails the token is still valid and the user can retry
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('id', tokenRow.user_id)

  if (updateErr) {
    log.error({ err: updateErr }, 'failed to update password_hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  // Consume the token only after a successful password update.
  // The optimistic lock (.is('used_at', null)) handles concurrent requests;
  // if it fails here the password is already set, so we treat it as success.
  const { data: claimed } = await supabase
    .from('password_set_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)
    .is('used_at', null)
    .select('id')
    .single()

  if (!claimed) {
    log.warn({ userId: tokenRow.user_id }, 'token already consumed by concurrent request')
  }

  return NextResponse.json({ ok: true })
}
```

#### change-password/route.ts

- [x] **Step 2: Replace app/api/auth/change-password/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'

const log = createLogger('auth:change-password')

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autenticato.' }, { status: 401 })
  }
  if (session.user.provider !== 'credentials') {
    return NextResponse.json({ error: 'Solo gli utenti con password interna possono cambiare la password.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { currentPassword, newPassword } = body ?? {}

  if (
    !currentPassword || typeof currentPassword !== 'string' ||
    !newPassword || typeof newPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'Dati mancanti.' }, { status: 400 })
  }

  const parsed = passwordSchema.safeParse(newPassword)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', session.user.id)
    .single()

  if (!user?.password_hash) {
    return NextResponse.json({ error: 'Nessuna password impostata per questo account.' }, { status: 400 })
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Password attuale non corretta.' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash: newHash })
    .eq('id', session.user.id)

  if (updateErr) {
    log.error({ err: updateErr }, 'failed to update password hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, requiresReauth: true })
}
```

- [x] **Step 3: Verify build**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 4: Verify no remaining console.* in auth files**

```bash
grep -rn "console\." \
  sources/microservices/web-construct/lib/mailer.ts \
  sources/microservices/web-construct/lib/auth.ts \
  sources/microservices/web-construct/app/api/auth/ \
  sources/microservices/web-construct/app/api/admin/
```

Expected: No output (zero matches).

- [x] **Step 5: Commit**

```bash
git add \
  sources/microservices/web-construct/app/api/auth/set-password/route.ts \
  sources/microservices/web-construct/app/api/auth/change-password/route.ts
git commit -m "feat(auth): enforce password policy server-side + pino logging (MIN-2)"
```

---

### Task 7: Align SetPasswordForm client-side validation

**Files:**
- Modify: `app/set-password/SetPasswordForm.tsx`

- [x] **Step 1: Replace the password validation block in handleSubmit**

In `SetPasswordForm.tsx`, find and replace the existing validation section:

Before:
```typescript
if (password.length < 8) {
  setError('La password deve essere di almeno 8 caratteri.')
  return
}
```

After:
```typescript
if (password.length < 8) {
  setError('La password deve contenere almeno 8 caratteri.')
  return
}
if (!/[A-Z]/.test(password)) {
  setError('La password deve contenere almeno una lettera maiuscola.')
  return
}
if (!/[0-9]/.test(password)) {
  setError('La password deve contenere almeno un numero.')
  return
}
```

- [x] **Step 2: Update the password input placeholder**

Before:
```typescript
placeholder="Minimo 8 caratteri"
```

After:
```typescript
placeholder="Min. 8 caratteri, una maiuscola, un numero"
```

- [x] **Step 3: Verify build**

```bash
cd sources/microservices/web-construct
npm run build
```

Expected: Build succeeds.

- [x] **Step 4: Commit**

```bash
git add sources/microservices/web-construct/app/set-password/SetPasswordForm.tsx
git commit -m "feat(auth): align set-password form validation with server-side policy"
```

---

### Task 8: Add LOG_LEVEL env var + manual verification + close review items

**Files:**
- Modify: `sources/microservices/web-construct/.env.template`
- Modify: `docs/reviews/2026-06-24-code-reviewer.md`

- [x] **Step 1: Add LOG_LEVEL to .env.template**

In `.env.template`, after the `AUTH_URL` block, add:

```
# Livello di log per pino (debug | info | warn | error). Default: info.
# Imposta a 'debug' in locale per log più dettagliati.
LOG_LEVEL=info
```

- [x] **Step 2: Manual verification — PII redaction**

Start the dev server:

```bash
cd sources/microservices/web-construct
npm run dev
```

Trigger a registration via `POST /api/auth/register` with a valid email. Watch the terminal. The log line from the mailer should show `"to":"[Redacted]"` — not the actual email address.

Expected server log (JSON):
```json
{"service":"web-construct","module":"mailer","provider":"resend","to":"[Redacted]","from":"onboarding@resend.dev","subject":"Benvenuto in Construct — Imposta la tua password","msg":"sending email"}
```

- [x] **Step 3: Manual verification — password policy**

With dev server running, open `http://localhost:3000/set-password?token=<any-valid-token>` and test:

| Password input | Expected API response |
|---------------|----------------------|
| `alllower1` | 400 — "La password deve contenere almeno una lettera maiuscola." |
| `NoNumbers` | 400 — "La password deve contenere almeno un numero." |
| `short1A` | 400 — "La password deve contenere almeno 8 caratteri." |
| `Valid1pass` | 200 — `{ ok: true }` |

- [x] **Step 4: Mark IMP-1 and MIN-2 as resolved in the review file**

In `docs/reviews/2026-06-24-code-reviewer.md`, update:

Before:
```
- [x] ID=IMP-1, Severity=Important, ...
- [x] ID=MIN-2, Severity=Minor, ...
```

After:
```
- [x] ID=IMP-1, Severity=Important, ...
- [x] ID=MIN-2, Severity=Minor, ...
```

- [x] **Step 5: Commit**

```bash
git add \
  sources/microservices/web-construct/.env.template \
  docs/reviews/2026-06-24-code-reviewer.md
git commit -m "chore(auth): add LOG_LEVEL env var, close IMP-1 and MIN-2 review items"
```
