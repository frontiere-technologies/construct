# Auth: Dedicated Pages for Register and Forgot Password

**Date:** 2026-06-26  
**Branch:** feature/finalize-oidc  
**Status:** Approved

## Summary

Replace the inline-expanded forms for "Registrati" and "Password dimenticata?" in the login card footer with dedicated full-page routes (`/register` and `/forgot-password`). The new pages reuse the same visual layout as `/set-password` (centered card, dark header, white body).

## Problem

Currently both forms expand inline inside `Login.tsx` in a cramped footer area with small text and a compressed layout. This is visually inconsistent with the set-password page and offers a poor UX — the card grows awkwardly and the forms feel secondary.

## Solution

### New pages

**`/forgot-password`** (`app/forgot-password/`)
- `page.tsx` — server component, renders `ForgotPasswordForm` inside the standard card shell
- `ForgotPasswordForm.tsx` — client component
  - States: `idle` → `sending` → `sent` | `error`
  - Idle/error: email input + "Invia link" button + "← Torna al login" link
  - Sent: green confirmation message + "← Torna al login" link
  - On submit: `POST /api/auth/forgot-password` (existing API, no changes)

**`/register`** (`app/register/`)
- `page.tsx` — server component, renders `RegisterForm` inside the standard card shell
- `RegisterForm.tsx` — client component
  - States: `idle` → `sending` → `sent` | `error`
  - Idle/error: email input + "Registrati" button + "← Torna al login" link
  - Sent: green confirmation message + "← Torna al login" link
  - On submit: `POST /api/auth/register` (existing API, no changes)

### Card shell pattern

Both pages wrap their form in the same structure used by `/set-password/page.tsx`:

```
min-h-screen flex items-center justify-center bg-gray-100
  └── card: w-full max-w-md rounded-xl shadow-lg overflow-hidden
        ├── header: bg-[#0f2336] px-8 py-8 text-center
        │     title + subtitle
        └── body: bg-white px-8 py-8
              <FormComponent />
```

### Login.tsx cleanup

Remove state variables: `forgotMode`, `forgotEmail`, `forgotStatus`, `registerMode`, `registerEmail`, `registerStatus` and their handlers (`handleForgotPassword`, `handleRegister`).

Replace the two inline form blocks with plain navigation:
- "Password dimenticata?" → `<a href="/forgot-password">`  
- "Registrati" → `<a href="/register">`

The `href` pre-fills the email in the forgot-password page is NOT implemented (out of scope — adds complexity for negligible gain).

## Files changed

| Action | Path |
|--------|------|
| Create | `app/forgot-password/page.tsx` |
| Create | `app/forgot-password/ForgotPasswordForm.tsx` |
| Create | `app/register/page.tsx` |
| Create | `app/register/RegisterForm.tsx` |
| Modify | `components/Login.tsx` |

No API routes, no database, no auth config changes.

## Out of scope

- Pre-filling email from the login form into the new pages
- Any visual redesign beyond matching the existing set-password style
- Changes to the test-mode login panel
