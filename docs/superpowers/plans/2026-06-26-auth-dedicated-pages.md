# Auth: Dedicated Pages for Register and Forgot Password — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline-expanded register/forgot-password forms in the login card footer with dedicated full-page routes at `/register` and `/forgot-password`.

**Architecture:** Two new Next.js App Router routes, each with a server `page.tsx` (layout shell) and a client `*Form.tsx` (interactive form), matching the visual pattern of the existing `/set-password` page. Login.tsx is simplified by removing all inline state and using plain `<a>` links.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, Playwright (Python/uv) for E2E tests.

## Global Constraints

- All commands run from `sources/microservices/web-construct/` unless stated otherwise
- E2E tests run with `uv run pytest` (never `python` or `python3` directly), from project root
- No changes to any API routes or Supabase schema
- Card shell visual: `min-h-screen flex items-center justify-center bg-gray-100` → `w-full max-w-md rounded-xl shadow-lg overflow-hidden` → header `bg-[#0f2336]` + body `bg-white px-8 py-8`
- Brand color class: `text-brand-blue`, `border-brand-blue`, `hover:bg-brand-blue`
- "Back to login" link target: `/login`

---

### Task 1: `/forgot-password` page

**Files:**
- Create: `app/forgot-password/ForgotPasswordForm.tsx`
- Create: `app/forgot-password/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/forgot-password` — `{ email: string }` → `{ ok: true }`
- Produces: route `/forgot-password` rendering `<ForgotPasswordForm />`

- [✅] **Step 1: Create `ForgotPasswordForm.tsx`**

```tsx
// app/forgot-password/ForgotPasswordForm.tsx
'use client'

import { useState } from 'react'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Se l&apos;email è registrata riceverai un link per reimpostare la password.
        </p>
        <a href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
          ← Torna al login
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Inserisci la tua email per ricevere un link di reset.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder="nome@esempio.it"
          className="rounded-lg border border-gray-300 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {status === 'error' && (
        <p className="text-red-600 text-sm">Errore. Riprova tra qualche istante.</p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white"
      >
        {status === 'sending' ? 'Invio…' : 'Invia link'}
      </button>
      <a href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
        ← Torna al login
      </a>
    </form>
  )
}
```

- [✅] **Step 2: Create `page.tsx`**

```tsx
// app/forgot-password/page.tsx
import { ForgotPasswordForm } from './ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>Reimposta la tua password</p>
        </div>
        <div className="bg-white px-8 py-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 3: Verify the page renders**

Start dev server if not running, then open `http://localhost:3000/forgot-password`.
Expected: card with dark header "Construct / Reimposta la tua password", email input, "Invia link" button, "← Torna al login" link.

- [✅] **Step 4: Commit**

```bash
git add app/forgot-password/
git commit -m "feat(auth): add dedicated /forgot-password page"
```

---

### Task 2: `/register` page

**Files:**
- Create: `app/register/RegisterForm.tsx`
- Create: `app/register/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register` — `{ email: string }` → `{ ok: true }`
- Produces: route `/register` rendering `<RegisterForm />`

- [✅] **Step 1: Create `RegisterForm.tsx`**

```tsx
// app/register/RegisterForm.tsx
'use client'

import { useState } from 'react'

export function RegisterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Se l&apos;email è autorizzata riceverai un link per completare la registrazione.
        </p>
        <a href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
          ← Torna al login
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Inserisci la tua email per ricevere un link di registrazione.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          placeholder="nome@esempio.it"
          className="rounded-lg border border-gray-300 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {status === 'error' && (
        <p className="text-red-600 text-sm">Errore. Riprova tra qualche istante.</p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-lg border-2 py-3 font-semibold text-sm transition disabled:opacity-50 border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white"
      >
        {status === 'sending' ? 'Invio…' : 'Registrati'}
      </button>
      <a href="/login" className="text-sm text-center hover:underline" style={{ color: '#0f5a8a' }}>
        ← Torna al login
      </a>
    </form>
  )
}
```

- [✅] **Step 2: Create `page.tsx`**

```tsx
// app/register/page.tsx
import { RegisterForm } from './RegisterForm'

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>Crea il tuo account</p>
        </div>
        <div className="bg-white px-8 py-8">
          <RegisterForm />
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 3: Verify the page renders**

Open `http://localhost:3000/register`.
Expected: card with dark header "Construct / Crea il tuo account", email input, "Registrati" button, "← Torna al login" link.

- [✅] **Step 4: Commit**

```bash
git add app/register/
git commit -m "feat(auth): add dedicated /register page"
```

---

### Task 3: Simplify `Login.tsx`

**Files:**
- Modify: `components/Login.tsx`

**Interfaces:**
- Consumes: nothing new — removes inline form logic
- Produces: clean Login component with `<a href="/forgot-password">` and `<a href="/register">`

- [✅] **Step 1: Remove inline state and handlers**

In `components/Login.tsx`, remove these lines from the `LoginForm` function:

```tsx
// REMOVE these state declarations:
const [forgotMode, setForgotMode] = useState(false)
const [forgotEmail, setForgotEmail] = useState('')
const [forgotStatus, setForgotStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
const [registerMode, setRegisterMode] = useState(false)
const [registerEmail, setRegisterEmail] = useState('')
const [registerStatus, setRegisterStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

// REMOVE these handlers:
const handleForgotPassword = async (e: React.FormEvent) => { ... }
const handleRegister = async (e: React.FormEvent) => { ... }
```

- [✅] **Step 2: Replace "Password dimenticata?" button with link**

Replace:
```tsx
<button
  type="button"
  onClick={() => { setForgotMode(true); setForgotEmail(email); setForgotStatus('idle'); setRegisterMode(false) }}
  className="text-xs hover:underline text-brand-blue"
>
  Password dimenticata?
</button>
```

With:
```tsx
<a href="/forgot-password" className="text-xs hover:underline text-brand-blue">
  Password dimenticata?
</a>
```

- [✅] **Step 3: Replace "Registrati" link**

Replace (in the footer section):
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

With:
```tsx
<a href="/register" className="font-semibold" style={{ color: '#0f5a8a' }}>
  Registrati
</a>
```

- [✅] **Step 4: Remove the two inline form blocks**

Delete the `{forgotMode && (...)}` block and the `{registerMode && (...)}` block from the footer section entirely.

- [✅] **Step 5: Check TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. (Dev server hot-reload is sufficient if build is slow — check for red underlines in IDE.)

- [✅] **Step 6: Verify login page in browser**

Open `http://localhost:3000/login`.
- "Password dimenticata?" should navigate to `/forgot-password`
- "Registrati" in the footer should navigate to `/register`
- The login card should no longer grow/expand — footer is now static

- [✅] **Step 7: Commit**

```bash
git add components/Login.tsx
git commit -m "refactor(auth): replace inline forms with dedicated page links"
```

---

### Task 4: Update E2E tests

**Files:**
- Modify: `sources/tests/e2e/test_register.py`

**Interfaces:**
- Consumes: `/register` and `/forgot-password` routes from Tasks 1–2; simplified `/login` from Task 3

The existing tests in `test_register.py` test the old inline behavior (expanding forms, Annulla button, mutual exclusion). All five tests need to be replaced with tests for the new page-navigation flow.

- [✅] **Step 1: Rewrite `test_register.py`**

Replace the entire file with:

```python
"""E2e tests for the self-registration flow (dedicated /register page)."""
import time

import pytest


def test_registrati_link_navigates_to_register_page(page, base_url):
    """Clicking 'Registrati' navigates to /register."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    page.click('text=Registrati')
    page.wait_for_url(f"{base_url}/register")
    assert page.url == f"{base_url}/register"
    assert page.locator('button[type="submit"]:has-text("Registrati")').is_visible()


def test_register_page_back_link_returns_to_login(page, base_url):
    """'← Torna al login' on /register navigates back to /login."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    page.click('text=← Torna al login')
    page.wait_for_url(f"{base_url}/login")
    assert page.url == f"{base_url}/login"


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain shows the confirmation message (no info leak)."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    page.locator('input[type="email"]').fill('hacker@notallowed.xyz')
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.'
    ).is_visible()


def test_register_authorized_domain_shows_confirmation(page, base_url):
    """Submitting an authorized domain shows the confirmation message."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    unique_email = f"register-test-{int(time.time())}@frontiere.io"
    page.locator('input[type="email"]').fill(unique_email)
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.'
    ).is_visible()


def test_forgot_password_link_navigates_to_dedicated_page(page, base_url):
    """Clicking 'Password dimenticata?' navigates to /forgot-password."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    page.click('text=Password dimenticata?')
    page.wait_for_url(f"{base_url}/forgot-password")
    assert page.url == f"{base_url}/forgot-password"
    assert page.locator('button[type="submit"]:has-text("Invia link")').is_visible()


def test_forgot_password_back_link_returns_to_login(page, base_url):
    """'← Torna al login' on /forgot-password navigates back to /login."""
    page.goto(f"{base_url}/forgot-password")
    page.wait_for_load_state("networkidle")

    page.click('text=← Torna al login')
    page.wait_for_url(f"{base_url}/login")
    assert page.url == f"{base_url}/login"


def test_forgot_password_submission_shows_confirmation(page, base_url):
    """Submitting any email shows the generic confirmation message (no info leak)."""
    page.goto(f"{base_url}/forgot-password")
    page.wait_for_load_state("networkidle")

    page.locator('input[type="email"]').fill('anyone@frontiere.io')
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è registrata riceverai un link per reimpostare la password.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è registrata riceverai un link per reimpostare la password.'
    ).is_visible()
```

- [✅] **Step 2: Run the new tests**

From the project root:
```bash
uv run pytest sources/tests/e2e/test_register.py -v
```

Expected: all 7 tests PASS.

- [✅] **Step 3: Run the full E2E suite**

```bash
uv run pytest sources/tests/e2e/ -v
```

Expected: all tests PASS (no regressions in `test_auth.py`, `test_sidebar.py`, etc.).

- [✅] **Step 4: Commit**

```bash
git add sources/tests/e2e/test_register.py
git commit -m "test(auth): update e2e tests for dedicated register/forgot-password pages"
```
