# Next.js Migration Design

**Date:** 2026-06-16  
**Branch:** feature/multi-repo  
**Scope:** Replace `apps/web/` Vite + React Router SPA with Next.js App Router  
**Motivation:** Align to industry-standard fullstack framework conventions

---

## 1. Goals

- Adopt Next.js App Router as the standard routing and rendering model
- Use `@supabase/ssr` for cookie-based auth compatible with Server Components
- Keep Tailwind CSS v4 and all existing UI components
- Fetch data server-side where possible (menu items, auth session)
- Maintain identical UX: same routes, same sidebar, same theme system

## 2. Non-Goals

- Rewriting UI components or business logic
- Adding new features
- Changing the Supabase schema
- SSG or ISR (all pages are auth-gated, no static content)

---

## 3. File Structure

```
apps/web/
├── app/
│   ├── layout.tsx              # Root layout (Server Component): metadata, global CSS, Providers
│   ├── providers.tsx           # 'use client': UIProvider wrapper
│   ├── login/
│   │   └── page.tsx            # Login page ('use client')
│   └── (protected)/            # Route group (no URL impact): all auth-gated pages
│       ├── layout.tsx          # Fetches menu items server-side, renders Sidebar + {children}
│       ├── page.tsx            # Home page
│       └── admin/
│           ├── menu-builder/
│           │   └── page.tsx
│           └── theme/
│               └── page.tsx
├── components/                 # Unchanged: Sidebar, SidebarItem, Layout, IconPicker, IconRenderer
├── lib/
│   ├── supabase-server.ts      # createServerClient — Server Components, middleware
│   └── supabase-browser.ts    # createBrowserClient — Client Components
├── types/
│   └── menu.ts                 # Unchanged
├── middleware.ts               # Route protection + session refresh
├── next.config.ts
├── postcss.config.ts
├── tsconfig.json               # Updated for Next.js
└── package.json                # Updated scripts and dependencies
```

**Deleted files:** `main.tsx`, `App.tsx`, `vite.config.ts`, `index.html`, `components/ProtectedRoute.tsx`, `context/AuthContext.tsx`, `context/MenuContext.tsx`

---

## 4. Routing

Current React Router routes map directly to Next.js file-based routing:

| React Router | Next.js App Router |
|---|---|
| `/` | `app/(protected)/page.tsx` |
| `/login` | `app/login/page.tsx` |
| `/admin/menu-builder` | `app/(protected)/admin/menu-builder/page.tsx` |
| `/admin/theme` | `app/(protected)/admin/theme/page.tsx` |
| `/admin` redirect | middleware redirect to `/admin/menu-builder` |

The `Layout` component (sidebar + outlet) becomes `app/(protected)/layout.tsx`. The route group `(protected)` does not appear in URLs — `/` and `/admin/menu-builder` are unchanged.

---

## 5. Auth: Supabase SSR

**Package:** `@supabase/ssr` replaces client-only session management.

**`middleware.ts`:**
- Runs before every request
- Uses `createServerClient` with request/response cookies
- If no valid session and route is not `/login` → redirect to `/login`
- Refreshes expired tokens transparently
- Replaces the `ProtectedRoute` React component entirely

**`lib/supabase-server.ts`:**
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options))
      }
    }
  )
}
```

**`lib/supabase-browser.ts`:**
```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**`AuthContext` (client-only, minimal):**  
No longer calls `getSession()` at mount. Uses `supabase.auth.getUser()` from `createBrowserClient` — reads the cookie already set by middleware. Exposes `user` and `signOut()`. Used only by components that need to display the user avatar or trigger sign-out.

---

## 6. Data Fetching: Menu Items

The current `MenuContext` fetches `menu_items` client-side with a loading spinner.

**New approach:**
- `app/(protected)/layout.tsx` fetches menu items server-side via `createServerClient`
- Menu items are passed as props to `Sidebar` and other consumers
- No loading state needed for the initial render

**Seeding logic** (insert defaults when table is empty) moves to a server action or is run once on the server during layout render.

---

## 7. Context Split: MenuContext → UIContext

The monolithic `MenuContext` splits into:

| Responsibility | Where |
|---|---|
| Menu items data | Server fetch → props |
| `saveMenuItems` (admin writes) | Client Component (Admin pages) |
| `isCollapsed`, `setIsCollapsed` | `UIContext` ('use client') |
| `settings` (theme, themeConfig) | `UIContext` ('use client'), persisted to `localStorage` |
| CSS variable side effects | `useEffect` in `UIContext` |

`UIContext` is a lightweight Client Component context. `settings` reads from `localStorage` on mount (with `typeof window !== 'undefined'` guard to avoid SSR hydration mismatch).

---

## 8. Theming

Unchanged behavior:
- Dark mode via `dark` class on `<html>`
- CSS custom properties (`--theme-primary`, etc.) set via `useEffect` in `UIContext`
- `localStorage` for persistence

The `@theme` block in `index.css` and Tailwind utility classes (`bg-sidebar-bg`, etc.) are unchanged.

---

## 9. Dependencies

**Removed:**
```
vite
@vitejs/plugin-react
@tailwindcss/vite
react-router-dom
dotenv
express
@types/express
```

**Added:**
```
next
@supabase/ssr
@tailwindcss/postcss
postcss
```

**Unchanged:** `react`, `react-dom`, `@supabase/supabase-js`, `tailwindcss`, `lucide-react`, `motion`, `clsx`, `tailwind-merge`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`

---

## 10. Configuration Files

**`next.config.ts`:**
```ts
const nextConfig = {
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  },
}
export default nextConfig
```

**`postcss.config.ts`:**
```ts
export default {
  plugins: { '@tailwindcss/postcss': {} }
}
```

**`tsconfig.json`:** Updated with Next.js defaults (`"moduleResolution": "bundler"`, `"jsx": "preserve"`, path alias `@/*`).

**`.env.local`:** Rename `VITE_SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `GEMINI_API_KEY` stays unchanged.

---

## 11. Scripts

**`apps/web/package.json`:**
```json
"scripts": {
  "dev": "next dev --port 3000",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "clean": "rm -rf .next"
}
```

**Root `package.json`:** Update `web:dev` and `web:build` convenience scripts accordingly.

---

## 12. Component Migration Summary

| File | Action |
|---|---|
| `main.tsx` | Delete |
| `App.tsx` | Delete → replaced by `app/layout.tsx` |
| `context/AuthContext.tsx` | Delete → replaced by `@supabase/ssr` + minimal client context |
| `context/MenuContext.tsx` | Delete → split into server fetch + `UIContext` |
| `components/ProtectedRoute.tsx` | Delete → replaced by `middleware.ts` |
| `components/Layout.tsx` | Keep, adapt for Next.js (remove `<Outlet />`, use `{children}`) |
| `components/Sidebar.tsx` | Keep, add `'use client'` (uses `usePathname` instead of `useLocation`) |
| `components/SidebarItem.tsx` | Keep, add `'use client'` |
| `components/IconRenderer.tsx` | Keep |
| `components/IconPicker.tsx` | Keep, add `'use client'` |
| `pages/Home.tsx` | Keep, becomes `app/page.tsx` content |
| `pages/Login.tsx` | Keep, add `'use client'`, use `router.push` from `next/navigation` |
| `pages/AdminMenuBuilder.tsx` | Keep, add `'use client'` |
| `pages/AdminTheme.tsx` | Keep, add `'use client'` |
| `lib/supabase.ts` | Rename/replace with `supabase-server.ts` + `supabase-browser.ts` |
| `index.css` | Keep unchanged |
| `vite.config.ts` | Delete |
| `index.html` | Delete |
