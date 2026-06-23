# Forgot Password & Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-service "Forgot Password" on the login page and "Change Password" on the profile page (credentials users only).

**Architecture:** Two new API routes (`/api/auth/forgot-password`, `/api/auth/change-password`) use the existing `password_set_tokens` table and bcrypt pattern from `send-invite`/`set-password`. The `provider` field is added to the Auth.js JWT/session so the profile page can conditionally show the change-password form only for internal (credentials) users.

**Tech Stack:** Next.js 15 App Router, Auth.js v5, bcryptjs, Resend, Supabase (admin client), TypeScript, Tailwind CSS v4

## Global Constraints

- All commands run from `apps/web/`
- Python commands: `uv run pytest` (never `python`/`python3`)
- No new dependencies — bcryptjs and Resend already installed
- Copy in Italian (same style as existing UI)
- Password minimum: 8 characters
- `AUTH_URL` must be set in `.env.local` (e.g. `AUTH_URL=http://localhost:3000`) for email links to work

---

### Task 1: Add `provider` to JWT and session

**Files:**
- Modify: `lib/auth.ts`
- Modify: `types/next-auth.d.ts`

**Interfaces:**
- Produces: `session.user.provider: string` — consumed by Task 5

- [✅] **Step 1: Update type augmentation**

Replace entire content of `types/next-auth.d.ts`:

```ts
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      provider: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    role: string
    provider: string
  }
}
```

- [✅] **Step 2: Store provider in JWT callback**

In `lib/auth.ts`, inside the `jwt` callback, after `token.role = ...`, add:

```ts
token.provider = account.provider   // add this line
```

The full `if (account && user)` block becomes:

```ts
if (account && user) {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('users')
      .upsert(
        {
          email: user.email,
          name: user.name,
          ...(user.image ? { avatar: user.image } : {}),
        },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select('id, role')
      .single()
    token.userId = (data?.id as string) ?? ''
    token.role = (data?.role as string) ?? 'user'
    token.provider = account.provider
  } catch (err) {
    console.error('[auth] Failed to provision user in Supabase:', err)
    throw err
  }
}
```

- [✅] **Step 3: Expose provider in session callback**

In `lib/auth.ts`, the `session` callback becomes:

```ts
async session({ session, token }) {
  session.user.id = token.userId as string
  session.user.role = token.role as string
  session.user.provider = token.provider as string
  return session
},
```

- [✅] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|compiled"
```

Expected: no `error TS` lines.

- [✅] **Step 5: Commit**

```bash
git add lib/auth.ts types/next-auth.d.ts
git commit -m "feat(auth): expose provider in JWT and session"
```

---

### Task 2: `POST /api/auth/forgot-password` endpoint

**Files:**
- Create: `app/api/auth/forgot-password/route.ts`

**Interfaces:**
- Consumes: `createAdminClient()` from `@/lib/supabase-server`, `Resend` from `resend`
- Produces: `POST /api/auth/forgot-password { email: string }` → `200 { ok: true }` always (no user enumeration)

- [✅] **Step 1: Create the route**

Create `app/api/auth/forgot-password/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email.toLowerCase().trim())
    .single()

  // Always return 200 — do not leak whether the email exists
  if (!user?.id) return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

  const { error: insertErr } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: user.id, token, expires_at: expiresAt })

  if (insertErr) {
    console.error('[forgot-password] Failed to create token:', insertErr)
    return NextResponse.json({ ok: true }) // still 200 — don't expose DB errors
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    console.error('[forgot-password] AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error: emailErr } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'noreply@frontiere.io',
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

  if (emailErr) {
    console.error('[forgot-password] Resend error:', emailErr)
  }

  return NextResponse.json({ ok: true })
}
```

- [✅] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|compiled"
```

Expected: no `error TS` lines.

- [✅] **Step 3: Test the endpoint manually**

With dev server running:

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@example.com"}' | jq .
```

Expected: `{ "ok": true }` (no error even for unknown email).

- [✅] **Step 4: Commit**

```bash
git add app/api/auth/forgot-password/route.ts
git commit -m "feat(api): add POST /api/auth/forgot-password"
```

---

### Task 3: "Password dimenticata?" UI in Login page

**Files:**
- Modify: `components/Login.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/forgot-password { email }` → `{ ok: true }`

- [✅] **Step 1: Add forgot-password state and handler to `LoginForm`**

Add to the state declarations inside `LoginForm` (after the existing `useState` calls):

```ts
const [forgotMode, setForgotMode] = useState(false)
const [forgotEmail, setForgotEmail] = useState('')
const [forgotStatus, setForgotStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
```

Add the handler (after `handleTestLogin`):

```ts
const handleForgotPassword = async (e: React.FormEvent) => {
  e.preventDefault()
  setForgotStatus('sending')
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail }),
    })
    setForgotStatus(res.ok ? 'sent' : 'error')
  } catch {
    setForgotStatus('error')
  }
}
```

- [✅] **Step 2: Add "Password dimenticata?" link below the password field**

In the credentials form, after the password `<div className="flex flex-col gap-1">...</div>` block and before `{errorMessage && ...}`, add:

```tsx
<div className="text-right -mt-2">
  <button
    type="button"
    onClick={() => { setForgotMode(true); setForgotEmail(email); setForgotStatus('idle') }}
    className="text-xs hover:underline"
    style={{ color: '#0f5a8a' }}
  >
    Password dimenticata?
  </button>
</div>
```

- [✅] **Step 3: Add forgot-password panel below the footer**

Inside the `<div className="bg-gray-50 border-t ...">` footer block, after the existing `<p>` tags and before the `{isTestMode && ...}` block, add:

```tsx
{forgotMode && (
  <div className="mt-3 pt-3 border-t border-gray-200">
    {forgotStatus === 'sent' ? (
      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        Se l&apos;email è registrata riceverai un link per reimpostare la password.
      </p>
    ) : (
      <form onSubmit={handleForgotPassword} className="flex flex-col gap-2">
        <p className="text-xs text-gray-500 text-left">Inserisci la tua email per ricevere un link di reset.</p>
        <input
          type="email"
          placeholder="nome@esempio.it"
          value={forgotEmail}
          onChange={e => setForgotEmail(e.target.value)}
          required
          className="border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50"
        />
        {forgotStatus === 'error' && (
          <p className="text-xs text-red-600">Errore. Riprova tra qualche istante.</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={forgotStatus === 'sending'}
            className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-50 transition"
            style={{ backgroundColor: '#0f5a8a' }}
          >
            {forgotStatus === 'sending' ? 'Invio…' : 'Invia link'}
          </button>
          <button
            type="button"
            onClick={() => setForgotMode(false)}
            className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
          >
            Annulla
          </button>
        </div>
      </form>
    )}
  </div>
)}
```

- [✅] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|compiled"
```

Expected: no `error TS` lines.

- [✅] **Step 5: Commit**

```bash
git add components/Login.tsx
git commit -m "feat(ui): add forgot-password flow to login page"
```

---

### Task 4: `POST /api/auth/change-password` endpoint

**Files:**
- Create: `app/api/auth/change-password/route.ts`

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth`, `createAdminClient()`, `bcrypt` from `bcryptjs`
- Produces: `POST /api/auth/change-password { currentPassword, newPassword }` → `200 { ok: true }` or error

- [✅] **Step 1: Create the route**

Create `app/api/auth/change-password/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-server'

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

  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'La nuova password deve contenere almeno 8 caratteri.' }, { status: 400 })
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
    console.error('[change-password] Failed to update hash:', updateErr)
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [✅] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|compiled"
```

Expected: no `error TS` lines.

- [✅] **Step 3: Commit**

```bash
git add app/api/auth/change-password/route.ts
git commit -m "feat(api): add POST /api/auth/change-password"
```

---

### Task 5: Change Password UI in Profile page

**Files:**
- Create: `components/ChangePasswordForm.tsx`
- Modify: `app/(protected)/profile/page.tsx` — pass `provider` to `ProfileForm`
- Modify: `components/ProfileForm.tsx` — accept `provider` prop, render `ChangePasswordForm` if `credentials`

**Interfaces:**
- Consumes: `session.user.provider` (from Task 1), `POST /api/auth/change-password` (from Task 4)

- [✅] **Step 1: Create `ChangePasswordForm` component**

Create `components/ChangePasswordForm.tsx`:

```tsx
'use client'

import React, { useState } from 'react'
import { Card } from '@/components/Card'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'Le nuove password non coincidono.' })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ type: 'error', message: data.error ?? 'Errore. Riprova.' })
      } else {
        setStatus({ type: 'success', message: 'Password aggiornata.' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setStatus(null), 3000)
      }
    } catch {
      setStatus({ type: 'error', message: 'Errore di rete. Riprova.' })
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <Card className="w-full max-w-sm mt-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
        Cambia password
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>Password attuale</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Nuova password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
            className={inputCls}
          />
          <p className="text-xs text-gray-400 mt-1">Minimo 8 caratteri.</p>
        </div>
        <div>
          <label className={labelCls}>Conferma nuova password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 px-4 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? 'Salvataggio…' : 'Aggiorna password'}
        </button>

        {status && (
          <p className={`text-sm text-center ${
            status.type === 'success'
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {status.type === 'success' ? '✓' : '✗'} {status.message}
          </p>
        )}
      </form>
    </Card>
  )
}
```

- [✅] **Step 2: Pass `provider` from profile page to `ProfileForm`**

In `app/(protected)/profile/page.tsx`, change the `ProfileForm` render to:

```tsx
return (
  <ProfileForm
    email={session.user.email ?? ''}
    avatarUrl={session.user.image ?? null}
    initialProfile={initialProfile}
    provider={session.user.provider ?? ''}
  />
)
```

- [✅] **Step 3: Update `ProfileForm` to accept `provider` and render `ChangePasswordForm`**

In `components/ProfileForm.tsx`:

1. Add `provider: string` to `ProfileFormProps`:

```ts
interface ProfileFormProps {
  email: string
  avatarUrl: string | null
  initialProfile: UserProfile
  provider: string
}
```

2. Destructure `provider` in the function signature:

```ts
export default function ProfileForm({ email, avatarUrl, initialProfile, provider }: ProfileFormProps) {
```

3. Add the import at the top:

```ts
import { ChangePasswordForm } from '@/components/ChangePasswordForm'
```

4. After the closing `</Card>` tag (end of the return), add:

```tsx
{provider === 'credentials' && <ChangePasswordForm />}
```

The full return block ends like:

```tsx
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center">
        <Card className="w-full max-w-sm">
          {/* ... existing content unchanged ... */}
        </Card>
        {provider === 'credentials' && <ChangePasswordForm />}
      </div>
    </div>
  )
```

Note: wrap the existing `<Card>` and the new `<ChangePasswordForm />` in a `<div className="flex flex-col items-center">` so they stack vertically centered.

- [✅] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|compiled"
```

Expected: no `error TS` lines.

- [✅] **Step 5: Commit**

```bash
git add components/ChangePasswordForm.tsx components/ProfileForm.tsx app/\(protected\)/profile/page.tsx
git commit -m "feat(ui): add change-password form to profile (credentials users only)"
```
