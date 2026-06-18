# Code Review — 2026-06-18

Scope: uncommitted changes on `feature/some-architectural-fixes` implementing the fixes
tracked in `docs/reviews/2026-06-18-architect-reviewer.md`. TypeScript `tsc --noEmit`
passes clean.

## Findings

| ID | Severity | Area | File | Line | Issue | Recommendation |
|----|----------|------|------|------|-------|----------------|
| CR-1 | HIGH | Perf / Bundle | `apps/web/components/IconPicker.tsx` | 4 | ~~`import * as Icons from 'lucide-react'` still pulls the entire icon set.~~ **Fixed**: replaced with `import dynamicIconImports from 'lucide-react/dynamicIconImports'`; keys converted to PascalCase. No icon components are bundled until rendered. | ✅ Fixed |
| CR-2 | MEDIUM | Data integrity | `apps/web/lib/menu-actions.ts` | 24-35 | ~~`updateMenuItemOrders` issues N sequential `UPDATE`s in a loop with no transaction.~~ **Fixed**: call replaced with a single `supabase.rpc('update_menu_orders', { updates })`. The `update_menu_orders(jsonb)` Postgres function (added to `schema.sql`) runs all order updates in one transaction as `SECURITY INVOKER`, so RLS still applies. | ✅ Fixed |
| CR-3 | LOW | Dead code | `apps/web/lib/menu-utils.ts` | 22-28 | `defaultMenu` is no longer referenced anywhere in the TS codebase (seeding moved to `schema.sql`, confirmed by grep). It is now duplicated state: the SQL seed and this array can drift silently. | Remove `defaultMenu` from `menu-utils.ts`, or add a comment that it exists only as documentation mirroring the SQL seed. The `mapToDb` import in the old layout is also gone, so nothing consumes it. |
| CR-4 | LOW | Data / redundancy | `apps/web/lib/profile-actions.ts` | 18-24; `apps/web/app/(protected)/profile/page.tsx` 11-14 | Now that `set_updated_at()` trigger exists (schema.sql:122-138), `saveProfile` still sets `updated_at` manually client-side. Harmless (trigger overwrites with `now()`), but redundant. Likewise the profile page lazy-`upsert` of the `users` row is now superseded by `handle_new_user()`. | Drop the manual `updated_at` from `saveProfile`. Keep the lazy upsert only if you want a safety net for users created before the trigger existed; otherwise remove it (MED-1 is otherwise fully addressed by the trigger). |
| CR-5 | LOW | Test quality | `tests/e2e/test_rbac.py` | 35, 43, 51 | The non-admin RBAC tests assert the URL no longer contains `/admin/...` after `wait_for_load_state("networkidle")`. The `redirect('/')` in the server component happens during SSR, so `goto` should land on `/` directly — fine. But the test only checks the negative (URL not containing the admin path); it does not assert the user landed on `/` nor that the admin UI is absent. A soft-404 or error boundary that keeps the URL would still pass weakly. | Strengthen: `assert non_admin_page.url.rstrip('/') == base_url.rstrip('/')` and optionally assert an admin-only element is not visible. Also the fixture depends on `TEST_EMAIL_USER`/`TEST_PASSWORD_USER` and a seeded non-admin `users` row whose `role != 'admin'`; document that prerequisite. |
| CR-6 | LOW | Correctness (latent) | `apps/web/components/AdminMenuBuilder.tsx` | 47-72 | `moveItem` swaps `order` between two siblings. If the seed/data ever has duplicate or non-contiguous `order` values within a sibling group, swapping values can produce a no-op or unstable ordering (the sort is by `order`, and `idx` is the rendered index, not the stored order). Today the seed is contiguous so it works, but the function trusts `order` to be unique per sibling group, which nothing enforces. | Either enforce contiguous order on save, or reindex the whole sibling group (`0..n-1`) on each move instead of swapping two raw values. Low priority given current data. |
| CR-7 | LOW | UX consistency | `apps/web/app/(protected)/error.tsx` | 21 | The error boundary "Try again" button uses `var(--theme-primary)`, which is set by `UIContext`'s `useEffect`. If the error occurs before the UI provider's effect runs (or in a context where the var is unset), the button background falls back to transparent on white text — effectively invisible. | Add a literal fallback: `bg-[var(--theme-primary,#6366f1)]`. Minor. |

No issues found in: `apps/web/lib/auth.ts`, `apps/web/lib/menu-service.ts` (clean centralization),
`apps/web/app/(protected)/layout.tsx`, `apps/web/app/(protected)/loading.tsx`,
`apps/web/components/IconRenderer.tsx` (correct lazy + cache + Suspense),
`apps/web/context/UIContext.tsx` (themeConfig now merged with defaults; `isCollapsed` dead state removed),
`apps/web/types/menu.ts`. No security holes, SSR/hydration regressions, unsafe casts, or
authz bypasses introduced. The server-component admin gate (CR-1 of the architect review) is
correctly implemented in both admin pages.

## Architect Review Cross-check

| Architect ID | Status | Notes |
|---|---|---|
| CRIT-1 | ✅ Fixed | `getUserRole()` + `redirect('/')` added to both `admin/menu-builder/page.tsx` and `admin/theme/page.tsx`. Defense-in-depth gate now present in the Server Components; middleware retained; RLS still backs the data layer. Correct. |
| HIGH-1 | ✅ Fixed | `updateMenuItemOrders` now calls `supabase.rpc('update_menu_orders', { updates })`. The Postgres RPC runs all order updates in one transaction as `SECURITY INVOKER` (RLS enforced). CR-2 resolved. |
| HIGH-2 | ✅ Fixed | Operations are now granular: edit upserts one row, move updates two rows, delete removes one row (cascade for children). No more full rewrite per micro-operation. |
| HIGH-3 | ✅ Fixed | Seed moved to `schema.sql` (`INSERT ... ON CONFLICT (id) DO NOTHING`); runtime seed removed from `getMenuItems()`. `menu-service.ts` no longer writes. Non-admin first-visit failure eliminated. |
| MED-1 | ✅ Fixed | `handle_new_user()` trigger on `auth.users` creates the `users` row with `role='user'` (security definer, `on conflict do nothing`). `is_admin()` now reliable from first login. Minor redundant lazy-upsert remains (CR-4). |
| MED-2 | ✅ Fixed | `PROTECTED_IDS` magic-string set replaced by a `system: boolean` column (DB, type, Zod, mapping, seed) and the builder branches on `item.system`. Survives UUID reseeding. Note `system` items still expose an Edit button only (no move/delete) — consistent. |
| MED-3 | ✅ Fixed | `IconRenderer` lazy-loads via dynamic `import()` with a cache. `IconPicker` now uses `lucide-react/dynamicIconImports` for icon names only (CR-1 resolved) — no icon components in the admin bundle until rendered. |
| MED-4 | ✅ Fixed | `themeConfig: { ...defaultThemeConfig, ...parsed?.themeConfig }` merge added in `UIContext` (line 26). Stale/partial stored config no longer leaves `undefined` keys. |
| MED-5 | ✅ Fixed (mostly) | Fixed `wait_for_timeout` sleeps replaced with condition waits (`wait_for`, `wait_for_function`); `data-testid` selectors added (`menu-item-row`, `delete-item-btn`, etc.) replacing fragile CSS-class selectors; new `test_rbac.py` adds unauthenticated + non-admin redirect coverage. RBAC assertions could be stronger (CR-5). Unit tests on `menu-utils`/diff still absent. |
| LOW-1 | ✅ Fixed | `menu_items` SELECT policy changed from public `using (true)` to `using (auth.uid() is not null)`. Admin route map no longer exposed to anonymous API callers. |
| LOW-2 | ✅ Fixed | `set_updated_at()` trigger added with `before update` triggers on both `menu_items` and `users`. |
| LOW-3 | ✅ Fixed | `error.tsx` (client boundary with `reset`) and `loading.tsx` (spinner) added to `(protected)`. Minor CSS-var fallback nit (CR-7). Catch-all 404 masking not addressed but was flagged as an observation, not a required fix. |
| LOW-4 | ✅ Fixed | `getMenuItems` centralized in `lib/menu-service.ts`; both layout and menu-builder page import the same function. The previous silent `defaultMenu` fallback in the builder page is gone (it now uses the shared throwing implementation, with `error.tsx` catching). Consistent error behavior. |
| LOW-5 | ✅ Fixed | `isCollapsed`/`setIsCollapsed` removed from `UIContext`; the Sidebar's `isCollapsed` props are local column state, unrelated. |

## Summary

This is a solid, well-targeted change set. 11 of the 15 architect findings are fully and
correctly fixed, including all three P0 items at the design level. The standout work:
the server-component admin gate (CRIT-1), the SQL-based seed plus `handle_new_user` trigger
(HIGH-3/MED-1), the `system` column replacing magic IDs (MED-2), and the much-improved E2E
tests with `data-testid` and condition-based waits (MED-5). TypeScript compiles clean and no
new security or SSR regressions were introduced.

CR-1 (HIGH-1/MED-3) and CR-2 are now fixed: `IconPicker` uses `lucide-react/dynamicIconImports`
for names only (no eager bundle), and `updateMenuItemOrders` is a single atomic Postgres RPC.
All architect P0/P1 items are fully resolved.

Remaining findings (CR-3 through CR-7) are low severity and can be batched into cleanup: dead
`defaultMenu` export, redundant manual `updated_at` in `saveProfile`, weak RBAC assertions in
`test_rbac.py`, latent order-contiguity assumption in `moveItem`, and the error-button CSS fallback.

Relevant files:
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/components/IconPicker.tsx`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/lib/menu-actions.ts`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/lib/menu-utils.ts`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/lib/profile-actions.ts`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/components/AdminMenuBuilder.tsx`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/apps/web/app/(protected)/error.tsx`
- `/Users/mario.stefanutti/mario/programming/github-frontiere/construct/tests/e2e/test_rbac.py`
