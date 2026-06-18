# Architecture Review — Construct

**Reviewer:** Senior Architecture Reviewer
**Date:** 2026-06-16
**Repository:** `/Users/mario.stefanutti/mario/programming/github-frontiere/construct`
**Branch:** `feature/small-fixes`
**Scope:** Full monorepo — frontend (`apps/web`), data layer (Supabase), deployment scaffolding (`deploy/k8s`), shared/services placeholders.

---

## 1. Executive Summary

`construct` is an **early-stage application shell / starter scaffold** built as a monorepo. The only implemented unit is the Next.js 15 (App Router) web application in `apps/web`, backed by Supabase for auth and persistence. The standout feature is a **database-driven, multi-level navigation system** (a "menu builder") that lets an authenticated user define the sidebar structure (top/main/bottom sections, nested containers, icons, roles, visibility) and persist it to Postgres.

The monorepo skeleton — `services/`, `packages/`, `deploy/k8s/base`, `deploy/k8s/overlays/{dev,staging,prod}` — is present but **entirely empty (only `.gitkeep` files)**. No backend microservice, no shared package, no Kubernetes manifest, and no CI/CD workflow exists yet.

**Overall assessment: a clean, well-organized MVP/foundation, not yet a production system.**

Strengths:
- Modern, coherent stack with correct App Router + `@supabase/ssr` cookie-session integration.
- Good separation of server-side data fetching from client-side interactivity.
- Sensible context split (`AuthContext` vs `UIContext`) with deliberate SSR-hydration handling.
- Self-documented via `CLAUDE.md` and design specs.

Material gaps:
- **Authorization is effectively absent** — the documented RBAC model is not implemented; any authenticated user can write any data.
- **No tests** of any kind (unit, integration, E2E), despite the team's own memory note requiring browser E2E verification.
- **No backend, no shared code, no deployment manifests** — the "microservices monorepo" is aspirational.
- Data-architecture issues: client-side bulk write path, no migrations, no observability, `app_settings`/`users` tables defined but unused by the app.

**Verdict:** A solid, maintainable starting point. To reach production-grade it needs authorization enforcement, a test harness, deployment substance, and a hardened data-write path.

---

## 2. Architecture Overview

### 2.1 Current high-level shape

```
                          Browser
                             │
            ┌────────────────┼───────────────────────────┐
            │ (cookie session: sb-* HttpOnly cookies)     │
            ▼                                             ▼
   middleware.ts (Edge)                          Client Components
   - createServerClient                          - AuthContext  (supabase-browser)
   - auth.getUser()                              - UIContext    (localStorage theme)
   - redirect unauth → /login                    - Sidebar, AdminMenuBuilder,
   - redirect auth on /login → /                   AdminTheme, Login
            │                                             │
            ▼                                             │ saveMenuItems()
   (protected) Server Layout                              │ (direct client → DB write)
   - createServerClient (cookies)                         │
   - getMenuItems() : SELECT menu_items ──────────┐       │
   - seeds defaults if empty                       │      │
            │ passes menuItems as props            ▼      ▼
            ▼                              ┌─────────────────────────┐
        <Layout> → <Sidebar>              │   Supabase (Postgres)   │
                                          │  menu_items (used)      │
                                          │  app_settings (unused)  │
                                          │  users        (unused)  │
                                          │  RLS: public read /     │
                                          │       authenticated write│
                                          └─────────────────────────┘

      services/ ── empty      packages/ ── empty      deploy/k8s/** ── empty
```

### 2.2 Component inventory (`apps/web`)

| Layer | Files | Role |
|---|---|---|
| Routing/shell | `app/layout.tsx`, `app/providers.tsx`, `app/(protected)/layout.tsx`, `[...slug]/page.tsx`, `login/page.tsx` | Root layout, provider tree, server-side menu fetch, catch-all placeholder |
| Auth/edge | `middleware.ts`, `lib/supabase-server.ts`, `lib/supabase-browser.ts` | Session refresh, route protection, SSR/CSR Supabase clients |
| State | `context/AuthContext.tsx`, `context/UIContext.tsx` | User/session; theme + collapse state |
| Domain logic | `lib/menu-utils.ts`, `lib/menu-actions.ts`, `types/menu.ts` | DTO mapping, defaults, write path, types |
| UI | `Sidebar.tsx`, `Layout.tsx`, `AdminMenuBuilder.tsx`, `AdminTheme.tsx`, `IconRenderer.tsx`, `IconPicker.tsx`, `Home.tsx`, `SidebarItem.tsx`, `Login.tsx` | Presentation |
| Data | `deploy/supabase/schema.sql` | DDL + RLS |

### 2.3 Key data flows

**Read (menu):** Server Component (`(protected)/layout.tsx`) → `createClient()` (cookies) → `SELECT * FROM menu_items ORDER BY "order"` → `mapFromDb` → props → `Layout` → `Sidebar`. If table empty, seeds `defaultMenu` server-side.

**Write (menu):** Admin UI (`AdminMenuBuilder`) holds local state → `saveMenuItems(previous, next)` (a **client** module) → diffs IDs → `DELETE ... IN (deletedIds)` then `upsert(...)` → `router.refresh()` re-runs the server fetch.

**Auth:** Login via `signInWithPassword` (browser client) → cookies set → `middleware.ts` validates every request via `auth.getUser()` and redirects.

**Theme:** `UIContext` reads/writes `localStorage` and pushes CSS variables onto `document.documentElement`. Note: theme is **per-browser only** — the `app_settings` table exists but is never read or written by the app.

---

## 3. Design Patterns Evaluation

| Pattern | Where | Assessment |
|---|---|---|
| Server/Client component split | App Router layouts vs `'use client'` components | **Appropriate.** Data fetch on the server, interactivity on the client. Idiomatic Next 15. |
| Provider/Context | `AuthProvider`, `UIProvider` | **Good.** Split by concern; both defer `localStorage`/auth reads to `useEffect` to avoid hydration mismatch — a deliberate, correct choice. |
| DTO mapper (anti-corruption) | `mapToDb` / `mapFromDb` | **Good.** Isolates DB snake_case from app camelCase. The one explicit boundary in the codebase. |
| Repository / data-access | — | **Missing.** Supabase queries are inlined into Server Components and a client action. No repository abstraction → future migration to a backend service requires touching many files. |
| Command/diff write | `saveMenuItems` | Reasonable for a small tree, but **diff-and-upsert from the client** is fragile (see §6, §7, §10). |
| Tree recursion | `AdminMenuBuilder.renderTree`, `getDescendantIds`, `Sidebar` selection logic | Functional but **O(n) `.filter()`/`.find()` per node repeatedly** → O(n²) on the full tree. Fine at current scale, a smell at scale. |
| Render-prop / sub-component | `Sidebar` `L1Item`, `SubItem` | Clean decomposition. |

**Architectural principles scorecard:**
- Separation of concerns: **good** at the frontend layer, **weak** at the data layer (no repository, business rules leak into UI).
- DRY: mostly respected; the duplicated `getMenuItems()` in two route files is a minor violation.
- KISS / YAGNI: respected on the frontend; the empty `services`/`packages`/`k8s` tree is the opposite of YAGNI but is explicitly scaffolding-by-design.

**Gap:** there is no domain layer. Menu validation rules (e.g. "a link must have a route", "containers may not be their own ancestor") live partly in UI (`getDescendantIds` filter in the parent dropdown) and partly nowhere.

---

## 4. Scalability Assessment

This is a navigation-shell app; "scale" here means **number of menu items, concurrent admins, and the eventual multi-service ambition** — not high-traffic data volume.

**Current limits / bottlenecks:**

1. **Whole-tree load and whole-tree save.** Every protected page render fetches *all* menu rows; every admin edit deletes-then-upserts the *entire* changed set. This is acceptable for tens of items, problematic for hundreds, and never paginated.
2. **No caching.** `menu_items` is read on every protected navigation via a Server Component with no `unstable_cache`/`revalidateTag` or Next data cache. For a value that changes rarely, this is wasteful. Each request also incurs a `auth.getUser()` round-trip in middleware *and* a DB select in the layout.
3. **O(n²) tree traversal** in both `Sidebar` and `AdminMenuBuilder` (repeated `.filter`/`.find`). Negligible now; a refactor to an index map (`Map<parentId, children[]>`) would future-proof it.
4. **Client-side write race.** Two admins editing concurrently will clobber each other; the diff is computed against the client's stale `committedItems`, not the server's current state. No optimistic concurrency (no `updated_at` check).
5. **Frontend scaling is fine** — Next.js scales horizontally and statelessly; Supabase handles connection pooling. The frontend tier has no inherent ceiling.

**Scaling path (when needed):**
- Add Next.js data cache + tag-based revalidation for `menu_items` (read scaling, near-free).
- Move the write path behind a Server Action or backend endpoint with concurrency control.
- Build the `parentId → children` index once per render.
- The microservices ambition (`services/`) is the real future scaling lever but is unimplemented; see §9 and §11.

---

## 5. Technology Stack Evaluation

| Technology | Version | Verdict | Notes |
|---|---|---|---|
| Next.js (App Router) | ^15.3.3 | **Justified** | Correct choice for SSR auth + RSC data fetching. Note: design specs show the project *migrated from Vite to Next.js* (`nextjs-migration-design.md`) — the multi-project spec still says "keep Vite". Docs are internally inconsistent; reality is Next.js. |
| React | ^19.0.0 | **Justified, slightly bleeding-edge** | React 19 is fine; ensure all transitive deps support it. |
| TypeScript | ~5.8 | **Justified** | Good. But `IconRenderer` uses `@ts-ignore` and `mapFromDb` uses unchecked `as` casts — type safety is bypassed exactly at the DB boundary where it matters most. |
| Tailwind CSS v4 | ^4.1 | **Justified** | v4 + `@tailwindcss/postcss` correctly configured per `CLAUDE.md`. CSS-variable theming is a clean pattern. |
| Supabase (`@supabase/ssr`) | ^0.12 / supabase-js ^2.99 | **Justified for MVP** | Auth + Postgres + RLS in one. The cookie-session integration is implemented correctly. Risk: business logic and authz become coupled to Supabase/RLS, which complicates the eventual backend-services split. |
| Lucide React | ^0.546 | **Justified** | Dynamic icon lookup is convenient. Caveat: `import * as Icons` likely defeats tree-shaking and pulls the **entire icon set** into the bundle — a real bundle-size concern. |
| `clsx` + `tailwind-merge` | — | **Justified** | Standard, lightweight. |
| `motion` (Framer Motion) | ^12.23 | **Questioned** | Listed as a dependency but not observed in any reviewed component. Possible dead dependency → audit. |
| `@google/genai` | ^1.29 | **Questioned / red flag** | A Gen-AI SDK is a dependency of a navigation-shell frontend with no observed usage. If unused, remove it; if used client-side it implies an **API key exposure risk**. Investigate. |

**Stack-level observations:**
- No linter config beyond `next lint`, no Prettier, no test runner, no `tsc --noEmit` gate, no CI. The toolchain stops at "it builds".
- "No monorepo orchestrator" (per spec) is a deliberate decision; defensible at this size, but cross-package type sharing in `packages/` will be painful without workspaces or path aliases.

---

## 6. Security Architecture

### 6.1 Authentication — **sound**
- `middleware.ts` validates `auth.getUser()` on every matched request (using `getUser()`, which verifies the JWT against Supabase, not the spoofable `getSession()` — correct).
- Cookie handling via `@supabase/ssr` `getAll`/`setAll` follows the recommended pattern in both middleware and server client.
- Unauthenticated → `/login`; authenticated on `/login` → `/`. Auth-callback path is excluded. Reasonable.

### 6.2 Authorization — **critical gap**

This is the most significant finding.

1. **No role enforcement anywhere.** `MenuItem.roles` exists and the RBAC tables are *documented* (`docs/tmp/rbac-db-structure.md`), but:
   - The DB RLS policies grant **write to ANY authenticated user**: `with check (auth.role() = 'authenticated')` on insert/update/delete for `menu_items` and `app_settings`. There is no admin check.
   - Therefore **any logged-in user can modify the entire navigation tree and theme**, regardless of their role.
   - The `Sidebar` does not filter items by the user's roles at all — `roles` is stored but never consulted for visibility.
   - The `/admin/*` routes are protected only by *being logged in*, not by being an admin. There is no server-side admin guard.
2. **RBAC model designed but not built.** `roles`, `role_claims`, `user_roles`, `get_user_claims()` are specified in docs but **absent from `schema.sql`** and unused by the app.
3. **`PROTECTED_IDS` is cosmetic.** `AdminMenuBuilder` hides delete buttons for IDs `14/16/17/18` in the UI only; a direct Supabase call (which any authenticated user can make) bypasses it entirely.

### 6.3 Other security observations
- **Avatar XSS/SSRF surface:** `Sidebar` renders `<img src={authUser.user_metadata.avatar_url}>` directly from user metadata. Low risk, but unvalidated.
- **Menu `route` is free-text** and rendered into `<Link href>`. A malicious authenticated user could set `javascript:`/external routes for other users. Validate route format on write.
- **Anon key in client** is expected and fine; security depends entirely on RLS — which is currently too permissive.
- **No CSP, security headers, rate limiting, or audit logging.**
- **`.env.local` is committed to the working tree** (present in `apps/web/`). Confirm it is gitignored and not pushed.

### 6.4 Recommendations (security)
1. **Implement the documented RBAC** in `schema.sql` and tighten RLS so writes require an admin claim (e.g. via a `SECURITY DEFINER` `is_admin()` predicate). **Highest priority.**
2. Add a **server-side admin guard** for `/admin/*` (e.g. an `admin/layout.tsx` that checks the user's role server-side and `notFound()`/redirects otherwise).
3. Filter sidebar items by the current user's roles.
4. Move writes off the client into a Server Action that re-validates authorization server-side.
5. Validate `route` and `avatar_url`; add security headers + CSP.

---

## 7. Data Architecture

### 7.1 Schema
- `menu_items`: `text` PK (caller-supplied via `Date.now().toString()` — **collision-prone** under concurrency; prefer UUIDs), self-referential `parent_id` with `ON DELETE CASCADE` (good — DB-level cascade exists, yet `AdminMenuBuilder` *also* re-implements cascade in JS, duplicating logic).
- `app_settings`: fully defined, **never used** by the app (theme lives in `localStorage`). Either wire it up (for cross-device theming) or drop it.
- `users`: defined, references `auth.users`, but **not populated or read** by the app. The app reads identity from `auth.users` metadata directly.
- RBAC tables: documented, **not in the schema**.

### 7.2 Consistency & integrity
- **No optimistic concurrency / `updated_at` guard** — last write wins, with the diff computed from stale client state (lost-update hazard).
- `updated_at` columns exist but **no trigger updates them** — they will reflect insert time forever.
- **No migration tooling.** `schema.sql` is a hand-maintained "reflects real DB state" file (its own header admits this). There is no Supabase migration history → schema drift between environments is likely and untracked.
- **No `position`/`order` uniqueness or sibling-ordering constraint** — ordering integrity is enforced only in app code.

### 7.3 Governance / operations
- No backup policy, no PITR note, no data-retention/PII statement (the app stores emails/avatars). No analytics or audit trail.
- Indexing: only the PK is indexed. `ORDER BY "order"` and `parent_id` lookups would benefit from indexes once data grows; the RBAC doc correctly adds indexes — apply the same discipline to the live schema.

---

## 8. Frontend Architecture

**Strengths:**
- **SSR/CSR split is exemplary for the menu read path:** data fetched in a Server Component, passed as props, consumed by a thin client `Layout`/`Sidebar`. This avoids client-side fetch waterfalls and flicker.
- **Hydration discipline:** both contexts initialize with deterministic defaults and only touch `localStorage`/auth in `useEffect` — the correct way to avoid hydration mismatches.
- **Context split** by lifecycle/concern (auth vs UI) is clean.
- Theming via CSS custom properties is flexible and avoids re-render storms.

**Weaknesses / smells:**
- **`Sidebar` is doing too much** (~440 lines): selection state, collapse persistence, tooltips via portal, user panel, theme toggle, three-column rendering. It mixes navigation, account, and theme concerns. Candidate for decomposition (`UserPanel`, `SidebarColumn`, `useSidebarSelection`).
- **Bundle:** `import * as Icons from 'lucide-react'` in `IconRenderer` likely ships the full icon library to the client. Switch to `lucide-react/dynamic` or a curated map.
- **Duplicated `getMenuItems`** in `(protected)/layout.tsx` and `admin/menu-builder/page.tsx` with divergent seeding behavior.
- **Catch-all `[...slug]` renders `Home` for any path** — meaning broken/typo links silently render the homepage instead of a 404. This masks routing errors and is a UX/SEO concern.
- **i18n is stubbed:** `settings.language` exists, UI strings are a mix of English and Italian (`"Accedi"`, `"Accesso in corso..."` in `Login`) — no actual i18n layer.
- **Accessibility:** custom toggle buttons lack `aria-*`/roles; tooltips are visual-only.
- **No error boundaries / loading states** (`error.tsx`, `loading.tsx` absent).

---

## 9. Integration Patterns

**Current state:** there is exactly one integration — the frontend talking directly to Supabase via SDK, both server-side (RSC + middleware) and client-side (browser client). There is **no API layer, no service boundary, no message bus**.

**What's missing for the stated microservices ambition:**
- No service contracts (no OpenAPI/gRPC/schema package). `packages/` — the intended home for shared types/contracts — is empty; even the `MenuItem` type that a future backend would share lives inside `apps/web/types`.
- No API gateway / BFF. Today the client writes to the DB directly (`saveMenuItems`); a microservices world needs that behind a service.
- No service discovery, circuit breakers, retries, or idempotency (the upsert is naturally idempotent on PK, which helps).
- No event-driven anything; no outbox; no async processing.

**Recommendation:** treat Supabase-direct-access as the *MVP integration pattern*, and when the first real service arrives, introduce a **BFF/API boundary and move shared contracts into `packages/`** before, not after, proliferating services.

---

## 10. Technical Debt Assessment

| Item | Severity | Notes |
|---|---|---|
| Authorization not implemented (any authed user is effectively admin) | **Critical** | Security + correctness. See §6. |
| No tests (unit/integration/E2E) | **High** | Contradicts the team's own E2E memory rule; every change is unverified beyond "it builds". |
| Client-side bulk delete+upsert write path | **High** | Lost updates, no server authz re-check, stale-diff hazard. |
| No DB migrations / schema drift | **High** | `schema.sql` is hand-curated; no history; multi-env drift inevitable. |
| `text` PK from `Date.now()` | **Medium** | Collision under concurrency; use UUID. |
| `app_settings` & `users` tables unused; theme is localStorage-only | **Medium** | Dead schema or missing feature; decide and converge. |
| `@google/genai` / `motion` possibly unused deps | **Medium** | Bundle bloat + (genai) potential key exposure if used client-side. |
| `import * as Icons` bundle bloat | **Medium** | Ships full icon set. |
| O(n²) tree traversals | **Low–Medium** | Fine now; index the tree before scale. |
| `[...slug]` masks 404s | **Low–Medium** | UX/SEO. |
| Duplicated `getMenuItems`, JS cascade duplicating DB cascade | **Low** | DRY. |
| `@ts-ignore` / unchecked `as` at DB boundary | **Low** | Type safety bypassed where most valuable. Consider Zod validation of DB rows. |
| Mixed-language UI strings, no i18n | **Low** | Polish + consistency. |
| Empty `services/`/`packages/`/`k8s/` + no CI | **Low (by design)** | Scaffolding-only; not debt yet, but the "monorepo of services" claim is aspirational. |
| Docs inconsistency (Vite vs Next.js) | **Low** | The multi-project spec still says "keep Vite"; reality is Next.js. |

---

## 11. Evolution Path (MVP → Production-Grade)

**Phase 0 — Harden the foundation (now):**
- Implement RBAC (schema + RLS admin checks) and a server-side `/admin` guard. Filter sidebar by roles.
- Introduce migrations (Supabase CLI) and make `schema.sql` generated, not hand-written.
- Add a test harness: Vitest/RTL for units, Playwright for the E2E flows the team already mandates (login, menu CRUD, theme).
- Add CI (lint + `tsc --noEmit` + build + tests) and dependency audit (`@google/genai`, `motion`).

**Phase 1 — Solidify the data write path:**
- Move `saveMenuItems` into a **Server Action** with server-side authz and `updated_at` optimistic-concurrency checks; switch PKs to UUID; add the missing `updated_at` triggers and indexes.
- Add Next data caching + tag revalidation for `menu_items`.
- Decide `app_settings`/`users`: either wire them (server-persisted theme, profile) or remove.

**Phase 2 — Establish service boundaries (when a real backend need appears):**
- Extract shared contracts/types into `packages/` (start with `MenuItem`/`AppSettings`).
- Introduce the first service in `services/` behind a BFF/API; stop writing to the DB from the browser.
- Populate `deploy/k8s/base` + overlays; add per-service CI workflows.

**Phase 3 — Operational maturity:**
- Observability (structured logs, error tracking, browser-error capture), backups/PITR policy, security headers/CSP, rate limiting, audit logging, accessibility pass, i18n.

---

## 12. Prioritized Recommendations (Impact × Effort)

| # | Recommendation | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Implement RBAC and tighten RLS so writes require admin; add server-side `/admin` guard | **Very High** | Medium | **P0** |
| 2 | Filter sidebar items by the authenticated user's roles | High | Low | **P0** |
| 3 | Move `saveMenuItems` to a Server Action with server-side authz + concurrency check | High | Medium | **P0** |
| 4 | Add E2E (Playwright) + unit tests + CI gate (lint/typecheck/build/test) | High | Medium | **P1** |
| 5 | Adopt Supabase migrations; treat `schema.sql` as generated | High | Medium | **P1** |
| 6 | Audit/remove `@google/genai` & `motion`; fix Lucide bundle (`lucide-react/dynamic`) | Med (security/bundle) | Low | **P1** |
| 7 | Switch menu PKs to UUID; add `updated_at` triggers + `parent_id`/`order` indexes | Medium | Low | **P2** |
| 8 | Resolve `app_settings`/`users`: wire up server-persisted theme/profile or remove | Medium | Medium | **P2** |
| 9 | Validate `route`/`avatar_url`; add CSP + security headers | Medium | Low | **P2** |
| 10 | Replace `[...slug]→Home` with a real 404; add `error.tsx`/`loading.tsx` | Medium | Low | **P2** |
| 11 | Decompose `Sidebar`; index the tree (`Map<parentId,children>`); de-dupe `getMenuItems` | Medium | Medium | **P3** |
| 12 | Move shared contracts to `packages/`; introduce Zod validation at the DB boundary | Medium | Medium | **P3** |
| 13 | Reconcile docs (Vite vs Next.js); add i18n; accessibility pass | Low | Low–Med | **P3** |

---

## 13. Conclusion

`construct` is a **well-built MVP shell with a genuinely useful, database-driven navigation system**, riding a modern and correctly-integrated stack (Next.js 15 App Router + `@supabase/ssr` + Tailwind v4). The frontend architecture — server-side data fetch, clean client/server split, deliberate hydration handling, concern-separated contexts — is the strongest part of the codebase and reflects competent engineering.

However, the project is **not yet production-grade**, and the gap between the documented ambition (a multi-service Kubernetes monorepo with RBAC) and the implemented reality (a single frontend, permissive RLS, no tests, no services, no deployment artifacts) is wide. The single most important issue is **authorization**: today any authenticated user can rewrite the application's navigation and theme, because RBAC is documented but unbuilt and RLS grants writes to all authenticated users. That, plus the absence of any automated tests and a client-side bulk-write path, are the blockers to calling this production-ready.

**Recommended next steps:** execute the three P0 items (RBAC + RLS hardening, role-based sidebar filtering, server-action write path), then stand up testing/CI and migrations (P1). Defer the microservices/k8s build-out until a concrete service need arises — and when it does, establish the `packages/` contract layer and a BFF boundary *before* multiplying services.

---

### Key files referenced
- Auth/edge: `apps/web/middleware.ts`, `apps/web/lib/supabase-server.ts`, `apps/web/lib/supabase-browser.ts`
- Data write path (highest-risk): `apps/web/lib/menu-actions.ts`
- Server fetch/seed: `apps/web/app/(protected)/layout.tsx`, `apps/web/app/(protected)/admin/menu-builder/page.tsx`
- Schema + RLS (authz gap): `deploy/supabase/schema.sql`
- RBAC design (unbuilt): `docs/tmp/rbac-db-structure.md`
- Largest component / decomposition target: `apps/web/components/Sidebar.tsx`
- Admin UI / client cascade duplication: `apps/web/components/AdminMenuBuilder.tsx`
- Bundle concern: `apps/web/components/IconRenderer.tsx`
- Empty scaffolding: `deploy/k8s/`, `services/`, `packages/` (all `.gitkeep` only)
