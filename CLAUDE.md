# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

```
construct/
├── apps/web/       ← React/Next.js frontend (App Router)
├── services/       ← backend microservices (empty, ready)
├── packages/       ← shared code between apps and services
├── deploy/
│   ├── k8s/        ← Kubernetes manifests (Kustomize)
│   └── supabase/   ← database schema
├── scripts/        ← utility scripts
└── docs/           ← documentation and specs
```

## Commands

```bash
# From repo root (convenience scripts)
npm run web:dev      # Start web dev server on port 3000
npm run web:build    # Production build
npm run web:lint     # Lint
npm run install:all  # Install all dependencies

# From apps/web/ directly
cd apps/web
npm install          # Install dependencies
npm run dev          # Start dev server on port 3000
npm run build        # Production build
npm run lint         # next lint
npm run clean        # Remove .next/
```

## Environment Setup

Create `apps/web/.env.local` with:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...   # Optional, for Gemini AI features (server-only)
```

## Architecture

**Stack:** React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + Supabase (@supabase/ssr) + Lucide React

**File structure under `apps/web/`:**
```
app/
  layout.tsx              # Root layout: metadata, global CSS, Providers
  providers.tsx           # 'use client': AuthProvider + UIProvider
  globals.css             # Tailwind v4 import + @theme + CSS variable defaults
  login/page.tsx          # Login page
  (protected)/            # Route group: all auth-gated pages
    layout.tsx            # Server Component: fetches menu items, renders Layout
    page.tsx              # Home
    [...slug]/page.tsx    # Catch-all for placeholder routes
    admin/
      menu-builder/page.tsx
      theme/page.tsx
components/               # Sidebar, Layout, IconRenderer, IconPicker, page components
context/
  UIContext.tsx           # 'use client': theme settings + sidebar collapse state
  AuthContext.tsx         # 'use client': Supabase browser client auth
lib/
  supabase-server.ts      # createServerClient (@supabase/ssr, Server Components)
  supabase-browser.ts     # createBrowserClient (@supabase/ssr, Client Components)
  menu-utils.ts           # defaultMenu, defaultSettings, mapToDb, mapFromDb
  menu-actions.ts         # 'use client': saveMenuItems (Supabase write)
middleware.ts             # Route protection + session refresh (replaces ProtectedRoute)
types/menu.ts             # MenuItem, AppSettings, ThemeConfig types
```

**Auth:** `middleware.ts` uses `@supabase/ssr` + cookie-based sessions. Unauthenticated requests to non-`/login` routes are redirected to `/login`. No client-side `ProtectedRoute` component.

**Data flow for menu items:**
1. `app/(protected)/layout.tsx` (Server Component) fetches all rows from `menu_items` ordered by `order`
2. If the table is empty, it seeds defaults server-side
3. Menu items are passed as props to `Layout` → `Sidebar`
4. `saveMenuItems()` in `lib/menu-actions.ts` is the sole write path (client-side, used by Admin page)

**Context split:**
- `UIContext` — theme settings (persisted to `localStorage`), sidebar collapse state, CSS variable side-effects via `useEffect`
- `AuthContext` — minimal: exposes `user`, `loading`, `signOut` using `createBrowserClient`
- Both initialize with defaults and read `localStorage` only in `useEffect` to avoid SSR hydration mismatch

**Routing:** All routes except `/login` are in the `(protected)` route group. `[...slug]` catches any undefined route (e.g. `/settings`, `/docs`) and renders the Home placeholder.

**Sidebar rendering:** `Sidebar` receives `menuItems` as a prop, splits by `position` (`top` | `main` | `bottom`), and renders a 3-column panel layout with collapsible sub-levels. Uses `usePathname()` and `useRouter()` from `next/navigation`.

**Theming:** CSS custom properties (`--theme-primary`, `--theme-sidebar-bg`, etc.) have static defaults in `globals.css` and are overridden dynamically by `UIContext` via `useEffect`. Dark mode uses the `dark` class on `<html>`. Tailwind utilities reference these vars via `bg-sidebar-bg`, `text-sidebar-text`, `text-primary`, etc.

**PostCSS / Tailwind v4:** `postcss.config.mjs` (must be `.mjs`, not `.ts`) loads `@tailwindcss/postcss`. `globals.css` uses `@source "../**/*.{ts,tsx,js,jsx}"` to scan all source files for utility class generation.

**Supabase schema:** `deploy/supabase/schema.sql` contains the full DDL. The `menu_items` table uses `text` PKs, a self-referential `parent_id`, and RLS policies (public read, authenticated write).

**Icon system:** Icons are Lucide React icons referenced by string name. `IconRenderer` does a dynamic lookup; `IconPicker` in the Admin UI provides a searchable picker.

## Adding a New Service

1. Create `services/<name>/` with its own `package.json` (name: `@construct/<name>`)
2. Add a `Dockerfile` in `services/<name>/`
3. Add Kubernetes manifests in `deploy/k8s/base/<name>/`
4. Add convenience scripts to the root `package.json`
