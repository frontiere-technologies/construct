# Code Review — Construct (2026-06-16) — Partially Fixed

**Original review:** [code-reviewer-2026-06-16.md](./code-reviewer-2026-06-16.md)
**Fix session:** 2026-06-16 (branch `feature/small-fixes`)
**TypeScript check after fixes:** `tsc --noEmit` — **0 errors**

## Fix Status Summary

| ID | Severity | Status | Fix applied |
|----|----------|--------|-------------|
| CRIT-1 | Critical | ✅ Fixed | `is_admin()` SQL function + RLS admin-only; middleware guard `/admin/*`; menu filtrato server-side per ruolo |
| CRIT-2 | Critical | ✅ Fixed | `/profile` page created (`profile/page.tsx` + `ProfileForm.tsx` + `profile-actions.ts`); DB migration + INSERT RLS policy applied; E2E test 14 added (branch `feature/small-fixes`, commit `41dc188`) |
| HIGH-1 | High | ✅ Fixed | `eslint.config.mjs` con `next/core-web-vitals` + `next/typescript`; script lint aggiornato; bug reale in `AdminTheme.tsx` risolto (`ColorPicker` fuori dal render) |
| HIGH-2 | High | ✅ Fixed | `SidebarItem.tsx` deleted; `tailwind-merge` removed from `package.json` |
| HIGH-3 | High | ✅ Fixed | `@google/genai` and `motion` removed from `package.json` |
| HIGH-4 | High | ✅ Fixed | `insert` → `upsert` con `ignoreDuplicates: true`; SELECT error ora lancia invece di swallowing |
| HIGH-5 | High | ✅ Fixed | `@ts-ignore` replaced with typed `LucideIcon` cast in `IconRenderer.tsx` |
| MED-1 | Medium | ✅ Fixed | Zod schema added to `menu-utils.ts`; `mapFromDb` uses `MenuItemRowSchema.parse()` — no more `as` casts |
| MED-2 | Medium | ✅ Fixed | `avatarError` state + `onError={() => setAvatarError(true)}` on `<img>` in `Sidebar.tsx` |
| MED-3 | Medium | ✅ Fixed | `app_settings` table removed from `schema.sql`; theme remains localStorage-only (`UIContext.tsx`) |
| MED-4 | Medium | ✅ Fixed | Upsert moved before delete in `menu-actions.ts` — data loss risk on partial failure eliminated |
| MED-5 | Medium | ✅ Fixed | CSS variable values validated with hex regex before `setProperty` |
| MED-6 | Medium | ✅ Fixed | `getDescendantIds` replaced with `useMemo` + `Set` in `AdminMenuBuilder.tsx`; filter uses `Set.has()` O(1) |
| MED-7 | Medium | ✅ Fixed | `&& i.active` added to all sidebar filters (`topItems`, `mainItems`, `bottomItems`, `l1Children`, `l2Children`, `hasChildren`) |
| LOW-1 | Low | ✅ Fixed | "Accedi" → "Sign In", "Accesso in corso..." → "Signing in..." in `Login.tsx` |
| LOW-2 | Low | ✅ Fixed | `Login.tsx` outer/card bg now has `dark:` variants |
| LOW-3 | Low | ✅ Fixed | Unused `User` interface removed from `types/menu.ts` |
| LOW-4 | Low | ✅ Fixed | `handleUserClick` wrapped in `useCallback` in `Sidebar.tsx` |
| LOW-5 | Low | ✅ Fixed | `activeRouteId`, `topItems`, `mainItems`, `bottomItems`, `l1Children`, `l2Children` wrapped in `useMemo` in `Sidebar.tsx` |
| LOW-6 | Low | ✅ Fixed | `router.push('/login')` added after `supabase.auth.signOut()` in `AuthContext.tsx` |
| LOW-7 | Low | ✅ Fixed | Floating `getUser()` promise now has `.catch(() => setLoading(false))` |
| LOW-8 | Low | ✅ Fixed | `Date.now().toString()` replaced with `crypto.randomUUID()` in `AdminMenuBuilder.tsx` |
| LOW-9 | Low | ✅ Fixed | Already aligned: both `schema.sql` and `menu-utils.ts` use `#6366f1` |

**Fixed: 22 / 23 — Remaining open: 1**

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

~~**[CRIT-1]**~~ ✅ Fixed:
1. `is_admin()` SQL function (`security definer`) in `schema.sql` + migrazione applicata al DB
2. RLS `menu_items` write policies riscritte: `authenticated` → `is_admin()`
3. Guard `/admin/*` in `middleware.ts` — query `users.role`, redirect a `/` se non admin
4. `getUserRole()` in `layout.tsx` — menu filtrato server-side, utenti non-admin non ricevono mai le voci admin

~~**[CRIT-2]**~~ ✅ Fixed — `app/(protected)/profile/page.tsx` created (Server Component + `ProfileForm.tsx` client component + `profile-actions.ts` helper). DB migration adds `first_name`, `last_name`, `username`, `phone` to `users` table; INSERT RLS policy added. E2E test 14 verifies navigation, form fields, save, and persistence. Commits `1e65dea`–`27974bc` on `feature/small-fixes`.

### ❌ High

~~**[HIGH-1]**~~ ✅ Fixed — `eslint.config.mjs` (flat config, `next/core-web-vitals` + `next/typescript`); script lint aggiornato a `eslint .`; `ColorPicker` spostato fuori dal render in `AdminTheme.tsx` (bug scoperto dal linter).

~~**[HIGH-4]**~~ ✅ Fixed — `upsert` con `ignoreDuplicates: true`; SELECT error ora fa `throw` invece di ritornare silenziosamente il default.

### ❌ Medium

~~**[MED-1]**~~ ✅ Fixed — Zod schema + `MenuItemRowSchema.parse()` in `mapFromDb`.

~~**[MED-2]**~~ ✅ Fixed — `avatarError` state + `onError` fallback to `CircleUser` in `Sidebar.tsx`.

~~**[MED-3]**~~ ✅ Fixed — `app_settings` table removed from `schema.sql`; theme stays localStorage-only.

~~**[MED-4]**~~ ✅ Fixed — upsert before delete in `menu-actions.ts`.

~~**[MED-6]**~~ ✅ Fixed — `descendantIds` computed once with `useMemo` returning a `Set`; filter uses `Set.has()`.

~~**[MED-7]**~~ ✅ Fixed — `&& i.active` added to all sidebar filters.

### ❌ Low

~~**[LOW-1]**~~ ✅ Fixed — "Sign In" / "Signing in..." in `Login.tsx`.

~~**[LOW-6]**~~ ✅ Fixed — `router.push('/login')` added to `signOut` in `AuthContext.tsx`.

~~**[LOW-9]**~~ ✅ Already aligned — both files use `#6366f1`.

---

## Recommended Next Steps

1. **(P0)** Fix CRIT-1 (RBAC + RLS) before merging this branch. ~~CRIT-2 fixed.~~
2. **(P1)** HIGH-1 (ESLint), HIGH-4 (seed race), MED-4 (atomic write).
3. **(P2)** MED-1 (Zod), MED-2 (avatar fallback), MED-6 (O(n²) memo).
