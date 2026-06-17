# Code Review — Construct (2026-06-16) — Partially Fixed

**Original review:** [code-reviewer-2026-06-16.md](./code-reviewer-2026-06-16.md)
**Fix session:** 2026-06-16 (branch `feature/small-fixes`)
**TypeScript check after fixes:** `tsc --noEmit` — **0 errors**

## Fix Status Summary

| ID | Severity | Status | Fix applied |
|----|----------|--------|-------------|
| CRIT-1 | Critical | ❌ Open | Authorization / RLS — requires schema + middleware changes |
| CRIT-2 | Critical | ✅ Fixed | `/profile` page created (`profile/page.tsx` + `ProfileForm.tsx` + `profile-actions.ts`); DB migration + INSERT RLS policy applied; E2E test 14 added (branch `feature/small-fixes`, commit `41dc188`) |
| HIGH-1 | High | ❌ Open | Missing ESLint config |
| HIGH-2 | High | ✅ Fixed | `SidebarItem.tsx` deleted; `tailwind-merge` removed from `package.json` |
| HIGH-3 | High | ✅ Fixed | `@google/genai` and `motion` removed from `package.json` |
| HIGH-4 | High | ❌ Open | Seed race condition + silent error swallowing |
| HIGH-5 | High | ✅ Fixed | `@ts-ignore` replaced with typed `LucideIcon` cast in `IconRenderer.tsx` |
| MED-1 | Medium | ❌ Open | `mapFromDb` unsafe casts without runtime validation |
| MED-2 | Medium | ❌ Open | `<img>` avatar — no `onError` fallback |
| MED-3 | Medium | ❌ Open | `app_settings` unused; theme localStorage-only |
| MED-4 | Medium | ❌ Open | `saveMenuItems` non-atomic (delete + upsert) |
| MED-5 | Medium | ✅ Fixed | CSS variable values validated with hex regex before `setProperty` |
| MED-6 | Medium | ❌ Open | O(n²) `getDescendantIds` in `AdminMenuBuilder` |
| MED-7 | Medium | ❌ Open | `active` field unused in rendering |
| LOW-1 | Low | ❌ Open | Italian strings in `Login.tsx` |
| LOW-2 | Low | ✅ Fixed | `Login.tsx` outer/card bg now has `dark:` variants |
| LOW-3 | Low | ✅ Fixed | Unused `User` interface removed from `types/menu.ts` |
| LOW-4 | Low | ✅ Fixed | `handleUserClick` wrapped in `useCallback` in `Sidebar.tsx` |
| LOW-5 | Low | ✅ Fixed | `activeRouteId`, `topItems`, `mainItems`, `bottomItems`, `l1Children`, `l2Children` wrapped in `useMemo` in `Sidebar.tsx` |
| LOW-6 | Low | ❌ Open | `signOut` does not redirect or clear state explicitly |
| LOW-7 | Low | ✅ Fixed | Floating `getUser()` promise now has `.catch(() => setLoading(false))` |
| LOW-8 | Low | ✅ Fixed | `Date.now().toString()` replaced with `crypto.randomUUID()` in `AdminMenuBuilder.tsx` |
| LOW-9 | Low | ❌ Open | Default color mismatch between `schema.sql` and `menu-utils.ts` |

**Fixed: 10 / 23 — Remaining open: 13**

---

## Applied Changes (detail)

### ✅ HIGH-2 — Dead code + unused dep removed
- **Deleted:** `apps/web/components/SidebarItem.tsx` (never imported anywhere)
- **Removed from `package.json`:** `tailwind-merge` (sole consumer was `SidebarItem.tsx`)

### ✅ HIGH-3 — Unused heavy dependencies removed
- **Removed from `package.json`:** `@google/genai ^1.29.0`, `motion ^12.23.24`
- `npm install` re-run to update `package-lock.json`

### ✅ HIGH-5 — `@ts-ignore` replaced with typed cast (`IconRenderer.tsx`)
```diff
- import React from 'react';
- import * as Icons from 'lucide-react';
+ import React from 'react';
+ import * as Icons from 'lucide-react';
+ import type { LucideIcon } from 'lucide-react';

-  // @ts-ignore
-  const IconComponent = Icons[name];
+  const IconComponent = (Icons as unknown as Record<string, LucideIcon | undefined>)[name];
```
Note: `unknown` intermediate cast required because lucide-react's barrel exports `Icon` (a `ForwardRefExoticComponent<IconComponentProps>`) alongside the standard `LucideIcon` shape, causing a direct cast overlap error on strict TS.

### ✅ MED-5 — Hex color validation before CSS variable injection (`UIContext.tsx`)
```diff
     const tc = settings.themeConfig || defaultThemeConfig
+    const dtc = defaultThemeConfig
+    const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
+    const safeColor = (v: string, fb: string) => isHex(v) ? v : fb
-    root.style.setProperty('--theme-primary', tc.primaryColor)
-    root.style.setProperty('--theme-sidebar-bg', isDark ? tc.sidebarBgDark : tc.sidebarBgLight)
+    root.style.setProperty('--theme-primary', safeColor(tc.primaryColor, dtc.primaryColor))
+    root.style.setProperty('--theme-sidebar-bg', safeColor(isDark ? tc.sidebarBgDark : tc.sidebarBgLight, isDark ? dtc.sidebarBgDark : dtc.sidebarBgLight))
     // (same pattern for sidebar-text, active-bg, active-text)
```
Invalid or tampered localStorage color values now fall back to `defaultThemeConfig` defaults instead of being injected raw.

### ✅ LOW-2 — Login page dark mode background (`components/Login.tsx`)
```diff
-  <div className="min-h-screen flex items-center justify-center bg-gray-50">
-    <div className="bg-white p-8 rounded-2xl shadow-md w-full max-w-sm">
+  <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
+    <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-md w-full max-w-sm">
```

### ✅ LOW-3 — Unused `User` interface removed (`types/menu.ts`)
The `User` interface (id, name, email, avatar, role) was never consumed — the app uses Supabase's `User` type directly from `@supabase/supabase-js`.

### ✅ LOW-4 — `handleUserClick` wrapped in `useCallback` (`Sidebar.tsx`)
```diff
-  const handleUserClick = () => {
+  const handleUserClick = useCallback(() => {
     setSelectedL1Id(null)
     setSelectedL2Id(null)
     setUserPanelOpen(prev => !prev)
-  }
+  }, [])
```

### ✅ LOW-5 — Derived values memoized (`Sidebar.tsx`)
Removed the `getRootItems` helper function; `MenuPosition` removed from imports (now unused). Six derived values wrapped in `useMemo`:
- `activeRouteId` — deps: `[menuItems, pathname]`
- `topItems`, `mainItems`, `bottomItems` — deps: `[menuItems]`
- `l1Children` — deps: `[menuItems, selectedL1Id]`
- `l2Children` — deps: `[menuItems, selectedL2Id]`

```diff
- import React, { useState, useEffect, useCallback } from 'react'
+ import React, { useState, useEffect, useCallback, useMemo } from 'react'
- import type { MenuItem, MenuPosition } from '@/types/menu'
+ import type { MenuItem } from '@/types/menu'

- const activeRouteId = menuItems.find(...)?.id ?? null
+ const activeRouteId = useMemo(() => menuItems.find(...)?.id ?? null, [menuItems, pathname])

- const getRootItems = (position: MenuPosition) => menuItems.filter(...).sort(...)
- const topItems = getRootItems('top')
- const mainItems = getRootItems('main')
- const bottomItems = getRootItems('bottom')
+ const topItems = useMemo(() => menuItems.filter(i => ... && i.position === 'top').sort(...), [menuItems])
+ const mainItems = useMemo(() => menuItems.filter(i => ... && i.position === 'main').sort(...), [menuItems])
+ const bottomItems = useMemo(() => menuItems.filter(i => ... && i.position === 'bottom').sort(...), [menuItems])
```

### ✅ LOW-7 — Floating promise fixed (`AuthContext.tsx`)
```diff
-  supabase.auth.getUser().then(({ data: { user } }) => {
-    setUser(user)
-    setLoading(false)
-  })
+  supabase.auth.getUser()
+    .then(({ data: { user } }) => {
+      setUser(user)
+      setLoading(false)
+    })
+    .catch(() => setLoading(false))
```
Network failures no longer leave `loading` stuck `true` forever.

### ✅ LOW-8 — `crypto.randomUUID()` for new menu item IDs (`AdminMenuBuilder.tsx`)
```diff
-  id: Date.now().toString(),
+  id: crypto.randomUUID(),
```
UUIDs are collision-free and sortable by creation time when used with a timestamp prefix; plain `Date.now()` (ms precision) is collision-prone under concurrent creation.

---

## Remaining Open Issues

The issues below are **not fixed** in this session. They require more design work, DB migrations, or are explicitly deferred.

### ❌ Critical — still blocking production

**[CRIT-1]** Authorization gap (any authenticated user = admin) — requires:
1. RBAC tables added to `schema.sql`
2. RLS policies rewritten to check admin claim
3. `/admin/*` server-side guard in `middleware.ts` or `admin/layout.tsx`
4. Sidebar role-based item filtering

~~**[CRIT-2]**~~ ✅ Fixed — `app/(protected)/profile/page.tsx` created (Server Component + `ProfileForm.tsx` client component + `profile-actions.ts` helper). DB migration adds `first_name`, `last_name`, `username`, `phone` to `users` table; INSERT RLS policy added. E2E test 14 verifies navigation, form fields, save, and persistence. Commits `1e65dea`–`27974bc` on `feature/small-fixes`.

### ❌ High

**[HIGH-1]** No ESLint config — add `eslint.config.mjs` extending `next/core-web-vitals` and wire into CI.

**[HIGH-4]** Seed race condition in `app/(protected)/layout.tsx` — switch to `upsert` with `ignoreDuplicates: true`; stop swallowing read errors.

### ❌ Medium

**[MED-1]** `mapFromDb` unchecked `as` casts — add Zod schema at DB boundary.

**[MED-2]** `<img>` avatar without `onError` fallback in `Sidebar.tsx:316` — add `onError` to fall back to `CircleUser`.

**[MED-3]** `app_settings` table unused; theme is localStorage-only — decide source of truth and either wire up or drop the table.

**[MED-4]** `saveMenuItems` non-atomic — wrap in Postgres RPC or restructure as Server Action with compensation.

**[MED-6]** O(n²) `getDescendantIds` in `AdminMenuBuilder.tsx:244` — precompute with `useMemo` before the filter.

**[MED-7]** `active` field stored but never checked in sidebar rendering — either use it or remove it.

### ❌ Low

**[LOW-1]** Italian UI strings in `Login.tsx` ("Accedi", "Accesso in corso...") — needs i18n decision first.

**[LOW-6]** `signOut` does not redirect to `/login` — add `router.push('/login')` after `supabase.auth.signOut()`.

**[LOW-9]** Default color mismatch: `schema.sql` defaults to `#6366f1` (indigo), `menu-utils.ts` defaults to `#2563eb` (blue) — align to one value.

---

## Recommended Next Steps

1. **(P0)** Fix CRIT-1 (RBAC + RLS) before merging this branch. ~~CRIT-2 fixed.~~
2. **(P1)** HIGH-1 (ESLint), HIGH-4 (seed race), MED-4 (atomic write).
3. **(P2)** MED-1 (Zod), MED-2 (avatar fallback), MED-6 (O(n²) memo).
