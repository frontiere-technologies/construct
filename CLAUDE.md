# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

```
construct/
├── apps/web/       ← React/Vite frontend
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
npm run web:lint     # Type-check
npm run install:all  # Install all dependencies

# From apps/web/ directly
cd apps/web
npm install          # Install dependencies
npm run dev          # Start dev server on port 3000 (0.0.0.0)
npm run build        # Production build
npm run lint         # Type-check with tsc --noEmit
npm run clean        # Remove dist/
```

## Environment Setup

Create `apps/web/.env.local` with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...   # Optional, for Gemini AI features
```

## Architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Supabase + React Router v7

**Two context providers wrap the entire app** (`apps/web/src/App.tsx`):
- `AuthContext` — Supabase auth session state; exposes `session`, `user`, `loading`, `signOut`
- `MenuContext` — Menu items loaded from Supabase `menu_items` table; also owns `AppSettings` (theme, themeConfig) persisted to `localStorage`, and sidebar collapse state

**Data flow for menu items:**
1. On mount, `MenuContext` fetches all rows from `menu_items` ordered by `order`
2. If the table is empty, it seeds defaults and inserts them
3. `saveMenuItems()` is the sole write path: it diffs against current state, deletes removed items, then upserts survivors
4. The `Admin` page is the only consumer of `saveMenuItems`

**Routing:** All routes except `/login` are wrapped in `ProtectedRoute` (checks `AuthContext.session`). The `Layout` component renders `Sidebar` + `<Outlet />`.

**Sidebar rendering:** `Sidebar` splits `menuItems` by `position` (`top` | `main` | `bottom`), renders only root items (`parentId === null`), and passes children down to recursive `SidebarItem` components. `SidebarItem` handles collapsible containers, active state detection (including child-active propagation), badges, and collapsed-mode tooltips.

**Theming:** CSS custom properties (`--theme-primary`, `--theme-sidebar-bg`, etc.) are set dynamically by `MenuContext` on every `settings` change. Dark mode uses the `dark` class on `<html>`. Tailwind utility classes reference these vars via `bg-sidebar-bg`, `text-sidebar-text`, `text-primary`, etc.

**Supabase schema:** `deploy/supabase/schema.sql` contains the full DDL. The `menu_items` table uses `text` PKs, a self-referential `parent_id`, and RLS policies (public read, authenticated write).

**Icon system:** Icons are Lucide React icons referenced by string name. `IconRenderer` does a dynamic lookup; `IconPicker` in the Admin UI provides a searchable picker.

## Adding a New Service

1. Create `services/<name>/` with its own `package.json` (name: `@construct/<name>`)
2. Add a `Dockerfile` in `services/<name>/`
3. Add Kubernetes manifests in `deploy/k8s/base/<name>/`
4. Add convenience scripts to the root `package.json`
