# Self-Registration via Credentials — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Registrati" self-registration flow: user enters email, domain is validated against allow-list, account is created with `auth_provider=credentials`, set-password link sent via email.

**Architecture:** New public API route handles user creation and token generation. UI change wires the existing dead "Registrati" link to an inline form, mirroring the existing `forgotMode` pattern in `LoginForm`.

**Tech Stack:** Next.js 15 App Router, Supabase (service role), NextAuth v5, Resend/SMTP via `sendEmail()`, Playwright e2e tests.

## Global Constraints

- All commands run from `apps/web/` unless otherwise noted
- Python test commands use `uv run pytest` — never `python` or `python3` directly
- E2e tests require dev server running at `http://localhost:3000` and `AUTH_TEST_CREDENTIALS=true`
- Always return `{ ok: true }` from the register route regardless of outcome (no info leak)
- New user role: `user`; `auth_provider`: `credentials`; token expiry: 48h

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/web/app/api/auth/register/route.ts` | Domain check, user creation, token, email |
| Modify | `apps/web/components/Login.tsx` | Add `registerMode` state + inline form |
| Create | `tests/e2e/test_register.py` | E2e coverage for register flow |

---

## Task 1: API route `POST /api/auth/register`

**Files:**
- Create: `apps/web/app/api/auth/register/route.ts`

**Interfaces:**
- Consumes: `createAdminClient()` from `@/lib/supabase-server`, `sendEmail()` from `@/lib/mailer`
- Produces: `POST /api/auth/register` accepts `{ email: string }`, always returns `{ ok: true }`

- [✅] **Step 1: Create the route file**

Create `apps/web/app/api/auth/register/route.ts` with this exact content:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/mailer'

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
  const { data: domainRows } = await supabase
    .from('allowed_domains')
    .select('domain')
    .eq('active', true)
  const allowedDomains = (domainRows ?? []).map((r: { domain: string }) => r.domain)
  if (!allowedDomains.includes(domain)) {
    return NextResponse.json({ ok: true })
  }

  // Duplicate email check
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .single()
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
    console.error('[register] Failed to create user:', insertError)
    return NextResponse.json({ ok: true })
  }

  // Create set-password token (48h)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { error: tokenError } = await supabase
    .from('password_set_tokens')
    .insert({ user_id: newUser.id, token, expires_at: expiresAt })
  if (tokenError) {
    console.error('[register] Failed to create token:', tokenError)
    return NextResponse.json({ ok: true })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    console.error('[register] AUTH_URL / NEXTAUTH_URL not set')
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
    console.error('[register] Failed to send email:', emailErr)
  }

  return NextResponse.json({ ok: true })
}
```

- [✅] **Step 2: Verify the route builds**

```bash
npm run build 2>&1 | grep -E "error|Error|✓"
```

Expected: no TypeScript errors, route appears in build output.

- [✅] **Step 3: Smoke-test the route with curl**

With the dev server running (`npm run dev`):

```bash
# Should always return { ok: true } — even for unauthorized domain
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@notallowed.com"}' | jq .
# Expected: {"ok":true}

# Authorized domain — check server logs for email send attempt
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@frontiere.io"}' | jq .
# Expected: {"ok":true}
```

- [✅] **Step 4: Commit**

```bash
git add apps/web/app/api/auth/register/route.ts
git commit -m "feat(api): add POST /api/auth/register for credentials self-registration"
```

---

## Task 2: UI — inline registration form in `Login.tsx`

**Files:**
- Modify: `apps/web/components/Login.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register` from Task 1
- Produces: visible inline form triggered by "Registrati" link

- [✅] **Step 1: Add register state variables**

In `LoginForm` (after the existing `forgotStatus` state line ~49), add:

```typescript
const [registerMode, setRegisterMode] = useState(false)
const [registerEmail, setRegisterEmail] = useState('')
const [registerStatus, setRegisterStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
```

- [✅] **Step 2: Add the submit handler**

After the `handleForgotPassword` function (~line 77), add:

```typescript
const handleRegister = async (e: React.FormEvent) => {
  e.preventDefault()
  setRegisterStatus('sending')
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registerEmail }),
    })
    setRegisterStatus(res.ok ? 'sent' : 'error')
  } catch {
    setRegisterStatus('error')
  }
}
```

- [✅] **Step 3: Wire the "Registrati" link**

Replace the current dead `<a href="#">` link (~line 190-198):

```tsx
<a
  href="#"
  onClick={e => {
    e.preventDefault()
    setRegisterMode(true)
    setForgotMode(false)
    setForgotStatus('idle')
    setRegisterEmail('')
    setRegisterStatus('idle')
  }}
  className="font-semibold"
  style={{ color: '#0f5a8a' }}
>
  Registrati
</a>
```

- [✅] **Step 4: Add the inline form**

In the footer `<div>`, after the closing `)}` of the `{forgotMode && (...)}` block and before the `{isTestMode && (...)}` block, add:

```tsx
{registerMode && (
  <div className="mt-3 pt-3 border-t border-gray-200">
    {registerStatus === 'sent' ? (
      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        Se l&apos;email è autorizzata riceverai un link per completare la registrazione.
      </p>
    ) : (
      <form onSubmit={handleRegister} className="flex flex-col gap-2">
        <p className="text-xs text-gray-500 text-left">Inserisci la tua email per ricevere un link di registrazione.</p>
        <input
          type="email"
          placeholder="nome@esempio.it"
          value={registerEmail}
          onChange={e => setRegisterEmail(e.target.value)}
          required
          className="border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50"
        />
        {registerStatus === 'error' && (
          <p className="text-xs text-red-600">Errore. Riprova tra qualche istante.</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={registerStatus === 'sending'}
            className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-50 transition"
            style={{ backgroundColor: '#0f5a8a' }}
          >
            {registerStatus === 'sending' ? 'Invio…' : 'Registrati'}
          </button>
          <button
            type="button"
            onClick={() => setRegisterMode(false)}
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

- [✅] **Step 5: Also close registerMode when forgotMode is opened**

Find the "Password dimenticata?" button handler (~line 143-146) and add `setRegisterMode(false)`:

```tsx
onClick={() => {
  setForgotMode(true)
  setForgotEmail(email)
  setForgotStatus('idle')
  setRegisterMode(false)
}}
```

- [✅] **Step 6: Verify no TypeScript errors**

```bash
npm run lint 2>&1 | grep -E "error|Error"
```

Expected: no errors.

- [✅] **Step 7: Commit**

```bash
git add apps/web/components/Login.tsx
git commit -m "feat(ui): wire Registrati link to inline self-registration form"
```

---

## Task 3: E2e test

**Files:**
- Create: `tests/e2e/test_register.py`

**Interfaces:**
- Consumes: `POST /api/auth/register` (Task 1), login page UI (Task 2)

- [✅] **Step 1: Create the test file**

Create `tests/e2e/test_register.py`:

```python
"""E2e tests for the self-registration flow."""
import pytest


def test_registrati_link_opens_form(page, base_url):
    """Clicking 'Registrati' expands the inline registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    # The form should not be visible initially
    assert not page.locator('input[placeholder="nome@esempio.it"]').is_visible() or \
           page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').count() == 0

    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    assert page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').is_visible()
    assert page.locator('button:has-text("Registrati")').is_visible()
    assert page.locator('button:has-text("Annulla")').is_visible()


def test_registrati_cancel_closes_form(page, base_url):
    """Clicking 'Annulla' hides the registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    page.click('button:has-text("Annulla")')
    page.wait_for_timeout(300)

    assert not page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').is_visible()


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain silently shows the confirmation message (no info leak)."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    page.fill('input[placeholder="nome@esempio.it"]', 'hacker@notallowed.xyz')
    page.click('button[type="submit"]:has-text("Registrati")')

    page.wait_for_selector('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.', timeout=5000)
    assert page.locator('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.').is_visible()


def test_register_authorized_domain_shows_confirmation(page, base_url):
    """Submitting an authorized domain shows the confirmation message."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    # Use a unique email to avoid duplicate-user conflicts across test runs
    import time
    unique_email = f"register-test-{int(time.time())}@frontiere.io"
    page.fill('input[placeholder="nome@esempio.it"]', unique_email)
    page.click('button[type="submit"]:has-text("Registrati")')

    page.wait_for_selector('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.', timeout=5000)
    assert page.locator('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.').is_visible()


def test_registrati_and_forgotmode_are_mutually_exclusive(page, base_url):
    """Opening 'Registrati' closes 'Password dimenticata?' and vice versa."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    # Open forgot-password
    page.click('text=Password dimenticata?')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di reset.')

    # Open register — should close forgot
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')
    assert not page.locator('text=Inserisci la tua email per ricevere un link di reset.').is_visible()
```

- [✅] **Step 2: Run the tests**

From the project root (with dev server already running):

```bash
uv run pytest tests/e2e/test_register.py -v
```

Expected output:
```
tests/e2e/test_register.py::test_registrati_link_opens_form PASSED
tests/e2e/test_register.py::test_registrati_cancel_closes_form PASSED
tests/e2e/test_register.py::test_register_unauthorized_domain_shows_confirmation PASSED
tests/e2e/test_register.py::test_register_authorized_domain_shows_confirmation PASSED
tests/e2e/test_register.py::test_registrati_and_forgotmode_are_mutually_exclusive PASSED
```

- [✅] **Step 3: Commit**

```bash
git add tests/e2e/test_register.py
git commit -m "test(e2e): add self-registration flow tests"
```
