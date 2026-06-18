# CLAUDE.md

## Commands

```bash
# From repo root
npm run web:dev      # Start web dev server on port 3000
npm run web:build    # Production build
npm run web:lint     # Lint
npm run install:all  # Install all dependencies

# From apps/web/
npm run dev
npm run build
npm run lint         # ESLint (eslint.config.mjs — next/core-web-vitals + next/typescript)
npm run clean        # Remove .next/

# E2E tests (Python — use uv, never python/python3 directly)
uv run pytest                              # tutti i test
uv run pytest tests/e2e/test_sidebar.py   # singolo gruppo
```

## Environment Setup

Create `apps/web/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Stack

React 19 + TypeScript + Next.js 15 (App Router) + Tailwind CSS v4 + Supabase (@supabase/ssr) + Lucide React

## Key Architectural Decisions

**Auth:** `middleware.ts` handles route protection via `@supabase/ssr` cookie sessions. There is no `ProtectedRoute` component — do not add one.

**Menu data flow:** `app/(protected)/layout.tsx` (Server Component) fetches `menu_items` from Supabase and seeds defaults if empty. `saveMenuItems()` in `lib/menu-actions.ts` is the only write path.

**Context / SSR:** `UIContext` and `AuthContext` read `localStorage` only inside `useEffect` — never at module level or during render — to avoid SSR hydration mismatches.

**PostCSS config must be `.mjs`:** `postcss.config.mjs` (not `.ts`) — changing the extension breaks the build.

**Supabase schema:** `deploy/supabase/schema.sql` — `menu_items` uses `text` PKs, self-referential `parent_id`, RLS (public read, authenticated write).

## Adding a New Service

1. Create `services/<name>/` with `package.json` (`name: "@construct/<name>"`)
2. Add `Dockerfile` in `services/<name>/`
3. Add Kubernetes manifests in `deploy/k8s/base/<name>/`
4. Add convenience scripts to the root `package.json`
