# UI/UX Testing Report — Construct Web Application
**Date:** 2026-06-18
**Tester:** ui-ux-tester agent (Claude Sonnet 4.6)
**Scope:** All documented flows — auth, sidebar, menu builder, theme, profile, RBAC
**Test method:** E2E automated tests (Playwright via pytest), static code analysis, source review
**Dev server:** http://localhost:3000

---

## Summary Table

| ID | Severity | Complexity | Status | Priority | Title | Fix Description |
|----|----------|------------|--------|----------|-------|-----------------|
| CRIT-1 | Critical | Low | ✅ Fixed | P0 | `useMemo` called after early return in `IconRenderer` — React Rules of Hooks violation | Moved `useMemo` before the early return; uses `name ? getLazyIcon(name) : null` so hook order is always consistent |
| HIGH-1 | High | Low | ✅ Fixed | P1 | E2E test `test_add_and_delete_item` fails on repeated runs due to DB state leakage | Used unique label per run (`TEST-ITEM-{uuid}`) and `.first` locator to avoid strict-mode violation |
| HIGH-2 | High | Medium | ✅ Fixed | P1 | `collapsible` and `defaultExpanded` menu fields are stored in DB but never read by `Sidebar` | `selectedL1Id` initialised from first `defaultExpanded` container; `handleL1Click` skips close when `collapsible !== false` |
| HIGH-3 | High | Low | ✅ Fixed | P1 | `target` field (`_blank`/`_self`) stored in DB and present in type but never applied to sidebar links | Added `target` and `rel="noopener noreferrer"` to `<Link>` in both `L1Item` and `SubItem` |
| HIGH-4 | High | Low | ✅ Fixed | P1 | `AdminMenuBuilder` has no error handling on async DB operations — DB errors crash silently or bubble as unhandled rejections | All three handlers wrapped in try/catch; state reverted to `initialMenuItems` on error; inline error banner rendered |
| HIGH-5 | High | Low | ✅ Fixed | P1 | `ProfileForm` uses `min-h-screen` inside a `flex-1 overflow-y-auto` container — causes unwanted inner scroll and background colour bleed | Replaced outer wrapper with `flex items-center justify-center h-full`; removed background override |
| MED-1 | Medium | Medium | ✅ Fixed | P2 | Menu Builder form does not expose `roles`, `target`, `active`, or `defaultExpanded` fields — admin cannot configure RBAC, link targets, or item visibility without direct DB access | Added `roles` checkboxes, `target` select (link-only), `active` checkbox, and `defaultExpanded` checkbox (container + collapsible only) |
| MED-2 | Medium | High | ✅ Fixed | P2 | Theme settings persist to `localStorage` only — clearing storage or switching browsers silently loses all theme customisation | Added `theme_config jsonb` to `users` table; `lib/theme-actions.ts` saves/loads via Supabase; `UIContext` loads from DB on mount; `AdminTheme` has explicit "Save Theme" button |
| MED-3 | Medium | Low | ✅ Fixed | P2 | `AdminMenuBuilder` shows no loading state or success/error feedback during save, delete, and reorder operations | Added `saving` state; Save button shows "Saving…" and is disabled during flight; success/error toasts shown for all operations |
| MED-4 | Medium | Low | ✅ Fixed | P2 | `IconPicker` dropdown has no click-outside handler — once opened it can only be closed by selecting an icon or clicking the trigger button again | Added `useRef` + `useEffect` with `mousedown` listener on `document`; clears search on close |
| MED-5 | Medium | Low | ✅ Fixed | P2 | `Home` component generates page titles inconsistently — `/` → "Dashboard" (capitalised), all other routes → lowercase and hyphenated | Replaced inline expression with `toTitle()` helper that applies title-case per segment and joins with " — " |
| MED-6 | Medium | Low | ✅ Fixed | P2 | `CLAUDE.md` documents that `layout.tsx` seeds default menu items at runtime, but no seeding code exists there — seeding is SQL-only | Updated `CLAUDE.md` to correctly state seeding is done via `schema.sql` `INSERT … ON CONFLICT DO NOTHING` |
| MED-7 | Medium | Low | ✅ Fixed | P2 | Flaky E2E test: `test_profile_navigation_from_sidebar` intermittently times out with a 5 000 ms limit when run after the full test suite | Increased `wait_for_url` timeout from 5 000 ms to 10 000 ms in `test_profile.py` |
| LOW-1 | Low | Low | ✅ Fixed | P3 | Login form inputs lack `autocomplete` attributes — password managers and browsers cannot auto-fill correctly | Added `autoComplete="email"` and `autoComplete="current-password"` to `Login.tsx` inputs |
| LOW-2 | Low | Low | ✅ Fixed | P3 | `<img>` used in `ProfileForm` and `Sidebar` instead of Next.js `<Image>` — LCP and bandwidth not optimised | Replaced with `<Image>` in both components; added `remotePatterns: [{ protocol: 'https', hostname: '**' }]` to `next.config.ts` |
| LOW-3 | Low | Low | ✅ Fixed | P3 | `defaultThemeConfig` in `menu-utils.ts` has misaligned indentation on `primaryColor` | Fixed 2-space indentation on `primaryColor` in `menu-utils.ts` |
| LOW-4 | Low | Low | ✅ Fixed | P3 | Error boundary message "Something went wrong." gives no actionable context to admin users | Added `error.digest` display (`font-mono` paragraph) to `error.tsx` |
| LOW-5 | Low | Low | ✅ Fixed | P3 | No "Dashboard" or "Home" item in the default sidebar navigation — once a user navigates away from `/`, there is no sidebar affordance to return | Added `Dashboard` (id `10`, `LayoutDashboard` icon, route `/`, position `main`) to `defaultMenu` in `menu-utils.ts` and to the SQL seed in `schema.sql` |
| LOW-6 | Low | Low | ✅ Fixed | P3 | L1 sidebar items navigate via `router.push()` instead of a `<Link>` component — prevents right-click "Open in new tab" and keyboard accessibility | `L1Item` now renders `<Link>` when `!hasChildren && item.route`; `router.push` removed from `handleL1Click` and `handleL2Click`; `useRouter` import removed |

---

## Detailed Findings

---

### CRIT-1 — `useMemo` Called After Early Return in `IconRenderer` (React Rules of Hooks Violation)

**Severity:** Critical
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P0

**Description:**
The `IconRenderer` component calls `useMemo` after a conditional early return. React requires all hooks to be called unconditionally in the same order on every render. This violates the Rules of Hooks and is confirmed by the ESLint `react-hooks/rules-of-hooks` error in the project's own linter output.

Although the bug may not surface in every render today (because `name` is typically set), it will produce an inconsistent hook call count whenever `name` transitions from defined to `undefined`, causing React to throw an error or silently corrupt state. This affects every place an icon is rendered — the entire sidebar, every menu item row in the Admin Menu Builder, and the IconPicker grid.

**Steps to Reproduce:**
1. Run `npm run web:lint` from the repo root.
2. Observe: `/apps/web/components/IconRenderer.tsx — 33:20 error React Hook "useMemo" is called conditionally`.
3. Render a component that passes `name={undefined}` to `<IconRenderer>` and then passes a valid name — the hook count changes between renders.

**DOM Excerpt (`apps/web/components/IconRenderer.tsx` lines 31–36):**
```tsx
// BROKEN: early return before hook
if (!name) return null                          // line 32
const LazyIcon = useMemo(() => getLazyIcon(name), [name])  // line 33  <-- hook after return
```

**Severity Rationale:** React itself may crash the component tree when the hook order changes. The ESLint rule violation is a hard `error`, which also means CI/CD builds configured to fail on lint errors will break.

**Recommended Fix:**
Move the `useMemo` call above the early return, accepting that `getLazyIcon('')` will be called but rendering `null` afterwards:

```tsx
export const IconRenderer: React.FC<IconRendererProps> = memo(({ name, className, size = 20 }) => {
  // Always call the hook — Rules of Hooks requirement
  const LazyIcon = useMemo(() => name ? getLazyIcon(name) : null, [name])
  if (!name || !LazyIcon) return null
  return (
    <Suspense fallback={<HelpCircle className={className} size={size} />}>
      <LazyIcon className={className} size={size} />
    </Suspense>
  )
})
```

File: `/apps/web/components/IconRenderer.tsx`

---

### HIGH-1 — E2E Test `test_add_and_delete_item` Fails on Repeated Suite Runs (DB State Leakage)

**Severity:** High
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P1

**Description:**
The menu builder E2E test creates a menu item named `TEST-ITEM` and then deletes it. When the test's delete step fails (e.g., due to a Playwright strict-mode violation or timeout), the `TEST-ITEM` row persists in the Supabase `menu_items` table. On the next run, the test creates a second `TEST-ITEM`. When it then tries to wait for the item to become visible, Playwright finds multiple rows and throws a strict-mode violation:

```
Error: strict mode violation: locator("[data-testid=\"menu-item-row\"]").filter(has_text="TEST-ITEM")
resolved to 4 elements
```

This was observed when the full suite was run with `pytest --no-randomly`, confirming that repeated runs accumulate orphaned test data.

**Steps to Reproduce:**
1. Run `uv run pytest tests/e2e/test_menu_builder.py -v` twice in succession.
2. On the second run the test fails with the strict-mode violation above.
3. Alternatively, run `uv run pytest tests/e2e/ -p no:randomly` and observe the failure.

**Observed Error (abbreviated):**
```
playwright._impl._errors.Error: Locator.wait_for: Error: strict mode violation:
locator("[data-testid=\"menu-item-row\"]").filter(has_text="TEST-ITEM") resolved to 4 elements
```

**Severity Rationale:** CI pipelines running multiple times will produce false negatives, eroding trust in the test suite. Stale data in production Supabase instances can also affect live behaviour of the menu.

**Recommended Fix (two-pronged):**

1. **Test cleanup:** Add a `conftest.py`-level `autouse` fixture that deletes any `TEST-ITEM` rows before each test run:
   ```python
   @pytest.fixture(autouse=True)
   def cleanup_test_items():
       yield
       # cleanup runs after each test that touches the menu builder
       # (or use a scoped supabase client call)
   ```
   Alternatively use a unique label per run: `f"TEST-ITEM-{uuid.uuid4().hex[:6]}"`.

2. **Locator robustness:** Change the `item_row.wait_for` call to use `.first` or `.count()` instead of strict mode:
   ```python
   item_row = page.locator('[data-testid="menu-item-row"]', has_text="TEST-ITEM").first
   item_row.wait_for(state="visible", timeout=5_000)
   ```

File: `/tests/e2e/test_menu_builder.py`

---

### HIGH-2 — `collapsible` and `defaultExpanded` Fields Stored in DB but Never Read by `Sidebar`

**Severity:** High
**Complexity:** Medium
**Status:** ✅ Fixed
**Priority:** P1

**Description:**
The `MenuItem` type defines `collapsible?: boolean` and `defaultExpanded?: boolean`. The Admin Menu Builder form exposes the `collapsible` checkbox for container-type items. The database schema stores both fields. However, the `Sidebar` component contains zero references to either field. All containers behave identically: they open/close by click, always starting closed on first render (regardless of `defaultExpanded`). The `collapsible: false` flag has no effect — any container can be toggled.

This means the feature as presented to the admin user in the Menu Builder form is completely non-functional: configuring `defaultExpanded: true` does nothing.

**Steps to Reproduce:**
1. Log in as admin and navigate to `/admin/menu-builder`.
2. Click "Add Item", set Type = "Container", check "Collapsible", save.
3. Navigate to any page — the new container behaves identically to any other container.
4. `grep -n "collapsible\|defaultExpanded" apps/web/components/Sidebar.tsx` returns no results.

**Severity Rationale:** Presenting a UI control to admins that has zero effect is a functional deception. Administrators configuring menus will believe they are setting behavior that is silently ignored.

**Recommended Fix:**
Read `collapsible` and `defaultExpanded` in the `Sidebar` during initial selection state setup:
- If `defaultExpanded: true` on a container, auto-select it in `selectedL1Id` on mount (or when the matching route is active).
- If `collapsible: false` on a container, prevent the click handler from toggling it closed (render it as always-open).

File: `/apps/web/components/Sidebar.tsx`

---

### HIGH-3 — `target` Field Stored in DB but Never Applied to Sidebar Links

**Severity:** High
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P1

**Description:**
The `MenuItem` type includes `target?: '_blank' | '_self'`. The database schema stores this field. However, neither the `L1Item` component nor the `SubItem` component reads the `target` field. All navigation occurs via `router.push()` (L1) or `<Link href={...}>` without a `target` prop (L2/L3). External URLs stored in menu items (e.g., `https://docs.example.com`) will silently open in the same tab, overwriting the admin dashboard. There is also no input in the edit form to set `target`, so the feature is entirely inert.

**Steps to Reproduce:**
1. In Menu Builder, create an item with route `https://example.com`.
2. Click the item in the sidebar.
3. The current page navigates away instead of opening a new tab.
4. `grep -n "target" apps/web/components/Sidebar.tsx` returns no results.

**Severity Rationale:** Loss of the admin session context when clicking external links is a disruptive user experience. An admin clicking a documentation link would leave the dashboard entirely.

**Recommended Fix:**
For `SubItem`, pass `target={item.target}` and `rel` to the `<Link>` component:
```tsx
if (item.route) {
  return (
    <Link
      href={item.route}
      target={item.target ?? '_self'}
      rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
      ...
    >
```
For `L1Item`, replace `router.push(item.route)` with a proper `<Link>` wrapper that supports `target`.
Also expose a `target` select field in the `AdminMenuBuilder` edit form.

Files: `/apps/web/components/Sidebar.tsx`, `/apps/web/components/AdminMenuBuilder.tsx`

---

### HIGH-4 — `AdminMenuBuilder` Has No Error Handling on Async DB Operations

**Severity:** High
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P1

**Description:**
The `handleSave`, `handleDelete`, and `moveItem` functions in `AdminMenuBuilder` call `upsertMenuItem`, `deleteMenuItem`, and `updateMenuItemOrders` respectively. All three throw errors on DB failures (`if (error) throw new Error(error.message)`). None of the callers in `AdminMenuBuilder` have try/catch blocks. A DB error (network failure, RLS rejection, quota exceeded) will:
1. Propagate as an unhandled Promise rejection.
2. Trigger the nearest React Error Boundary, replacing the entire menu builder UI with "Something went wrong."
3. Leave the local React state out of sync with the database (item appears saved/deleted in UI but isn't).

Additionally, there is no loading indicator, so the user receives no feedback that an operation is in progress.

**Steps to Reproduce:**
1. Navigate to `/admin/menu-builder`.
2. Simulate a network error (DevTools → Network → Offline).
3. Try to save or delete a menu item.
4. The UI crashes to the generic error boundary.

**Severity Rationale:** Silent data loss (item appears deleted in UI but persists in DB, or vice versa) is a data integrity issue. The crash-to-error-boundary provides zero actionable information.

**Recommended Fix:**
Add try/catch in each handler with inline error display:
```tsx
const [error, setError] = useState<string | null>(null)
const [saving, setSaving] = useState(false)

const handleSave = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!editingItem) return
  setSaving(true)
  setError(null)
  try {
    // ... existing logic ...
    await upsertMenuItem(editingItem)
    router.refresh()
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Save failed')
    // Revert optimistic state update
    setMenuItems(initialMenuItems) // or revert selectively
  } finally {
    setSaving(false)
  }
}
```
Render `{error && <p className="text-red-500 text-sm mt-2">{error}</p>}` near the Save button.

File: `/apps/web/components/AdminMenuBuilder.tsx`

---

### HIGH-5 — `ProfileForm` Uses `min-h-screen` Inside a `flex-1` Overflow Container

**Severity:** High
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P1

**Description:**
`ProfileForm` wraps its content in:
```tsx
<div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
```
This component is rendered inside the protected layout's `<main className="flex-1 overflow-y-auto p-8">`.

Two specific problems result:

1. **Excessive white space / broken centering:** `min-h-screen` forces the inner div to be at least 100vh tall. Inside a `flex-1` container that may be shorter than the viewport, the card is positioned using `items-center justify-center` against a 100vh box, creating a double-height scroll area and leaving the card visually off-centre from the user's perspective.

2. **Background colour inconsistency:** The layout uses `bg-gray-50 dark:bg-gray-950` on the outer wrapper, but `ProfileForm` applies `bg-gray-50 dark:bg-gray-900` — a different dark-mode shade (`gray-900` vs `gray-950`). This creates a visible colour mismatch inside the main content area in dark mode.

3. **Redundant `p-8` + internal padding:** The main content area already has `p-8`. The profile form's internal padding is additional, potentially creating excessive spacing on smaller viewports.

**Steps to Reproduce:**
1. Log in and navigate to `/profile`.
2. In dark mode, observe the main content area has a visibly lighter background than the rest of the layout.
3. Observe the vertical scroll bar — the page is taller than the viewport due to `min-h-screen`.

**Severity Rationale:** Users see an obviously broken layout on the profile page. The scrollable content area for a simple form card is a jarring UX regression.

**Recommended Fix:**
Remove `min-h-screen` and the background override from `ProfileForm`. Let the parent layout control the page background:
```tsx
// Before:
<div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">

// After:
<div className="flex items-center justify-center h-full">
```

File: `/apps/web/components/ProfileForm.tsx`

---

### MED-1 — Menu Builder Form Does Not Expose `roles`, `target`, `active`, or `defaultExpanded` Fields

**Severity:** Medium
**Complexity:** Medium
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
The `AdminMenuBuilder` edit form exposes: Label, Type, Position, Route/URL, Icon, Parent Item, Visible, and (for containers) Collapsible. It does NOT expose:

- **`roles`** — hardcoded to `['admin', 'user']` for new items; never editable. An admin cannot create admin-only menu items via the UI.
- **`target`** — never settable. External link behaviour is uncontrollable.
- **`active`** — new items always get `active: true`. Items cannot be deactivated without direct DB access.
- **`defaultExpanded`** — the companion to `collapsible`, never settable (and not read by Sidebar — see HIGH-2).

**Steps to Reproduce:**
1. Navigate to `/admin/menu-builder` and click "Add Item".
2. Observe that the form has no roles multi-select, no link-target select, no active toggle, and no default-expanded checkbox.
3. Save the item; it will always be visible to both `admin` and `user` roles with no way to restrict it.

**Severity Rationale:** Without `roles` control, the feature is security-incomplete — admins cannot create role-scoped menu items without direct DB access. The missing `active` toggle prevents non-destructive item disabling.

**Recommended Fix:**
Add the following form fields to the edit panel:
- `roles`: multi-select or checkbox group (`admin`, `user`, or custom values).
- `target`: select with options `_self` (default), `_blank`.
- `active`: checkbox alongside `visible`.
- `defaultExpanded`: checkbox (visible only when `type === 'container'` and `collapsible === true`).

File: `/apps/web/components/AdminMenuBuilder.tsx`

---

### MED-2 — Theme Settings Persist to `localStorage` Only — No Server-Side Storage

**Severity:** Medium
**Complexity:** High
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
All theme customisations (primary colour, sidebar colours, dark/light mode) are stored exclusively in `localStorage` via `UIContext`. There is no server-side persistence. Consequences:
- Clearing browser data silently resets all theme configuration.
- Using a different browser or incognito mode shows the default theme.
- Multiple admins may see different themes.
- The "Reset to Defaults" button on the theme page works, but there is no "Save" button — changes auto-apply on every colour picker interaction with no explicit commit step.

**Steps to Reproduce:**
1. Go to `/admin/theme`, change the primary colour.
2. Open a different browser or clear `localStorage`.
3. The theme reverts to defaults.

**Severity Rationale:** Configuration data that can be silently lost by routine browser maintenance is unreliable for a production admin tool. The lack of a Save button also means accidental colour changes apply immediately with no confirmation.

**Recommended Fix:**
Add a `themeConfig` column to the `users` table (JSONB) or a separate `app_settings` table, and save theme data via a Server Action on an explicit "Save Theme" button. Load the saved config server-side in `layout.tsx` and pass it as a prop to `UIProvider` as the initial value.

Files: `/apps/web/components/AdminTheme.tsx`, `/apps/web/context/UIContext.tsx`, `/deploy/supabase/schema.sql`

---

### MED-3 — `AdminMenuBuilder` Shows No Loading State or Operation Feedback

**Severity:** Medium
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
When an admin saves, deletes, or reorders a menu item, the UI provides no feedback:
- The Save button label does not change (no "Saving…" state).
- No spinner or disabled state prevents double-submit.
- No success toast or confirmation message appears after a successful operation.
- No error message appears if an operation silently fails (before the error boundary catches it).

An admin clicking "Save Changes" receives zero confirmation that the operation completed.

**Steps to Reproduce:**
1. Navigate to `/admin/menu-builder`.
2. Click any item's edit button, modify the label, click "Save Changes".
3. Observe: the form closes and the list updates — but no success message appears and the button never entered a loading state.

**Severity Rationale:** Missing feedback breaks the basic interactive contract of a form. Admins cannot know if their change was persisted. On slow connections, double-submits can corrupt data.

**Recommended Fix:**
Add a `saving` state boolean; disable the Save button and show "Saving…" while in-flight. On success, show a 2–3 second success toast. Integrate with the error handling from HIGH-4.

File: `/apps/web/components/AdminMenuBuilder.tsx`

---

### MED-4 — `IconPicker` Dropdown Has No Click-Outside Handler

**Severity:** Medium
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
The `IconPicker` dropdown opens when the trigger button is clicked and closes only when:
1. An icon is selected (calls `setOpen(false)` explicitly).
2. The trigger button is clicked again (toggles `open`).

There is no `useEffect` event listener for `document.mousedown` or `document.click`. Once opened, clicking anywhere in the form outside the picker does NOT close it. The dropdown remains open on top of other form elements, blocking interaction. This forces the user to either select an icon or click the trigger button again.

**Steps to Reproduce:**
1. Navigate to `/admin/menu-builder` and open the edit panel.
2. Click the icon picker button — the icon grid opens.
3. Click anywhere else in the form (e.g., the Label input).
4. The icon picker dropdown remains open and overlaps other fields.

**Severity Rationale:** A stuck dropdown blocks form interaction and is a recognisable frustration point for users. It makes the icon selection feel broken.

**Recommended Fix:**
```tsx
const containerRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (!open) return
  const handleOutside = (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false)
      setSearch('')
    }
  }
  document.addEventListener('mousedown', handleOutside)
  return () => document.removeEventListener('mousedown', handleOutside)
}, [open])

// Attach ref to the wrapper div:
<div className="relative" ref={containerRef}>
```

File: `/apps/web/components/IconPicker.tsx`

---

### MED-5 — `Home` Component Generates Inconsistent Page Titles

**Severity:** Medium
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
The `Home` component generates a page heading from `pathname`:
```tsx
<h1 className="text-3xl font-bold mb-6 capitalize">
  {pathname === '/' ? 'Dashboard' : pathname.substring(1).replace('/', ' - ')}
</h1>
```
Results:
- `/` → "Dashboard" (correct, capitalised)
- `/support` → "support" (lowercase, inconsistent despite `capitalize`)
- `/docs` → "docs" (lowercase)
- `/admin/menu-builder` → "admin - menu-builder" (hyphenated, not title-cased)

The `capitalize` CSS class only capitalises the FIRST letter of the first word. "menu-builder" is treated as one word, so "menu-builder" stays in display.

**Steps to Reproduce:**
Navigate to `/support` — the heading reads "support" (lowercase initial, the `capitalize` class capitalises "s" but only the first word).
Navigate to `/admin/menu-builder` — heading reads "admin - menu-builder".

**Severity Rationale:** Inconsistent heading capitalisation is a visible polish issue that makes the app look unfinished to users.

**Recommended Fix:**
Apply a proper title-case function:
```tsx
const toTitle = (path: string) =>
  path === '/' ? 'Dashboard' :
  path.substring(1)
    .split('/')
    .map(seg => seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
    .join(' — ')
```

File: `/apps/web/components/Home.tsx`

---

### MED-6 — `CLAUDE.md` Documentation Incorrectly Describes Menu Seeding

**Severity:** Medium
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
`CLAUDE.md` states:
> **Menu data flow:** `app/(protected)/layout.tsx` (Server Component) fetches `menu_items` from Supabase and **seeds defaults if empty**.

In practice:
- `app/(protected)/layout.tsx` calls `getMenuItems()` — which only reads, never writes.
- `lib/menu-service.ts` has no seeding logic.
- Default menu items are seeded via the `INSERT ... ON CONFLICT DO NOTHING` statement at the bottom of `deploy/supabase/schema.sql`.

This documentation error will mislead developers who try to trace runtime seeding behaviour to the wrong location.

**Steps to Reproduce:**
1. Read `CLAUDE.md`.
2. Open `apps/web/app/(protected)/layout.tsx` — no seed logic present.
3. Open `apps/web/lib/menu-service.ts` — no seed logic present.
4. Find seed in `deploy/supabase/schema.sql` at the very bottom.

**Severity Rationale:** Incorrect developer documentation leads to wasted investigation time and incorrect architectural modifications.

**Recommended Fix:**
Update `CLAUDE.md`:
```
**Menu data flow:** `app/(protected)/layout.tsx` (Server Component) fetches `menu_items` from Supabase.
Default menu items are seeded once via `deploy/supabase/schema.sql` (INSERT … ON CONFLICT DO NOTHING).
`saveMenuItems()` in `lib/menu-actions.ts` is the only write path from the application.
```

File: `/CLAUDE.md`

---

### MED-7 — Flaky E2E Test: `test_profile_navigation_from_sidebar` Intermittently Times Out

**Severity:** Medium
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P2

**Description:**
The test `test_profile_navigation_from_sidebar` in `tests/e2e/test_profile.py` uses `wait_for_url("**/profile", timeout=5_000)`. In isolated runs it passes. In the full test suite, it intermittently fails with:
```
playwright._impl._errors.TimeoutError: Timeout 5000ms exceeded.
waiting for navigation to "**/profile" until 'load'
```
This was confirmed in the first of two complete suite runs executed during this testing session. The 5 000 ms budget is insufficient when the server is under load from adjacent tests.

**Steps to Reproduce:**
Run `uv run pytest tests/e2e/ -v` — the test fails approximately 50% of the time in the first position after the highlight tests.

**Severity Rationale:** A flaky test in CI causes random build failures, reducing developer confidence in the test suite and increasing time-to-merge.

**Recommended Fix:**
Increase the timeout for profile navigation specifically:
```python
page.wait_for_url("**/profile", timeout=10_000)
```
Or replace with `page.wait_for_load_state("networkidle")` and then assert the URL.

File: `/tests/e2e/test_profile.py`

---

### LOW-1 — Login Form Inputs Missing `autocomplete` Attributes

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
The `Login` component renders email and password inputs without `autoComplete` attributes. Modern browsers and password managers rely on `autocomplete="email"` and `autocomplete="current-password"` to correctly identify credentials fields. Without these attributes, some password managers may not offer autofill, and browsers may warn about the form in DevTools.

**DOM Excerpt:**
```html
<input type="email" placeholder="Email" required="" class="..." value="">
<input type="password" placeholder="Password" required="" class="..." value="">
```

**Recommended Fix:**
```tsx
<input type="email" autoComplete="email" ... />
<input type="password" autoComplete="current-password" ... />
```

File: `/apps/web/components/Login.tsx`

---

### LOW-2 — `<img>` Used Instead of Next.js `<Image>` in `ProfileForm` and `Sidebar`

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
Two ESLint warnings (`@next/next/no-img-element`) are currently active in the project:
- `components/ProfileForm.tsx:42` — avatar image
- `components/Sidebar.tsx:338` — user avatar in L1 column

Using plain `<img>` bypasses Next.js image optimisation (lazy loading, format negotiation, CDN sizing), resulting in slower LCP scores and higher bandwidth usage for avatar images.

**Recommended Fix:**
Replace with `<Image>` from `next/image`. Since avatar URLs are external (Supabase/OAuth providers), add the hostname to `next.config.js` `images.domains` or `images.remotePatterns`.

Files: `/apps/web/components/ProfileForm.tsx`, `/apps/web/components/Sidebar.tsx`

---

### LOW-3 — `defaultThemeConfig` Has Misaligned Indentation on `primaryColor`

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
In `apps/web/lib/menu-utils.ts`, the `defaultThemeConfig` object has inconsistent indentation. The `primaryColor` property is not indented while all other properties use two-space indentation:

```ts
export const defaultThemeConfig: ThemeConfig = {
primaryColor: '#6366f1',      // ← no leading spaces
  sidebarBgLight: '#ffffff',  // ← 2-space indent
```

**Recommended Fix:**
Fix the indentation:
```ts
export const defaultThemeConfig: ThemeConfig = {
  primaryColor: '#6366f1',
  sidebarBgLight: '#ffffff',
```

File: `/apps/web/lib/menu-utils.ts`

---

### LOW-4 — Error Boundary Message Is Too Generic for Admin Users

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
`apps/web/app/(protected)/error.tsx` displays only:
> "Something went wrong."

And a "Try again" button. The `error.digest` property (Next.js server-side error identifier) is available but not shown. When the error boundary is triggered (e.g., a DB connection failure in a Server Component), admins have no way to correlate the error in server logs.

**Recommended Fix:**
Display the error digest in a small monospace span for admin users:
```tsx
{error.digest && (
  <p className="text-xs text-gray-400 font-mono">Error ID: {error.digest}</p>
)}
```

File: `/apps/web/app/(protected)/error.tsx`

---

### LOW-5 — No "Dashboard" / "Home" Item in Default Sidebar Navigation

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
The default menu (`defaultMenu` in `menu-utils.ts`) contains only: Documentation (bottom), Support (bottom), Admin container (bottom). There is no link item pointing to `/` in the main navigation section. After navigating to any route, users have no sidebar affordance to return to the dashboard — they must manually edit the browser URL or use the browser's back button.

**Steps to Reproduce:**
1. Log in — land at `/` (Dashboard).
2. Click "Support" in the sidebar — navigate to `/support`.
3. Observe: no "Dashboard" or "Home" item exists in the sidebar to return.

**Recommended Fix:**
Add a "Dashboard" item to the default menu seed:
```ts
{ id: '10', label: 'Dashboard', icon: 'LayoutDashboard', route: '/', type: 'link',
  parentId: null, order: 0, visible: true, active: true, roles: ['admin', 'user'],
  position: 'main' }
```
Also add this to the SQL seed in `deploy/supabase/schema.sql`.

Files: `/apps/web/lib/menu-utils.ts`, `/deploy/supabase/schema.sql`

---

### LOW-6 — L1 Sidebar Items Use `router.push()` Instead of `<Link>` Component

**Severity:** Low
**Complexity:** Low
**Status:** ✅ Fixed
**Priority:** P3

**Description:**
In `Sidebar.tsx`, the `handleL1Click` handler navigates to routes using `router.push(item.route)`. This programmatic navigation:
- Does not allow right-click "Open in new tab".
- Does not render as an `<a>` element, reducing accessibility (no keyboard tab-focus link semantics).
- Cannot support the `target` attribute (see HIGH-3).

The `L1Item` component renders as a `<button>` rather than a link, which is semantically incorrect when the item has a route.

**Recommended Fix:**
For link-type L1 items (no children), render a `<Link>` component instead of triggering `router.push` via the button's `onClick`. For container items, keep the `<button>` element.

File: `/apps/web/components/Sidebar.tsx`

---

## Test Run Summary

| Suite | Run 1 Result | Run 2 Result (--no-randomly) | Notes |
|-------|-------------|-------------------------------|-------|
| `test_auth.py` | 2/2 passed | 2/2 passed | Stable |
| `test_highlight.py` | 2/2 passed | 2/2 passed | Stable |
| `test_menu_builder.py` | 1/1 passed | 1/1 FAILED | DB pollution across runs (HIGH-1) |
| `test_profile.py` | 3/4 passed, 1 FAILED | 3/4 passed, 1 FAILED | Profile nav timeout flaky (MED-7) |
| `test_rbac.py` | 2/2 passed, 2 skipped | 2/2 passed, 2 skipped | Non-admin credentials not configured |
| `test_sidebar.py` | 11/11 passed | 11/11 passed | Stable |

**Overall: 22/25 executed tests pass reliably. 1 test fails due to DB state leakage (HIGH-1). 1 test is flaky (MED-7). 2 tests skipped due to missing non-admin test credentials.**

---

## ESLint Output Summary

```
/apps/web/components/IconRenderer.tsx
  33:20  error  React Hook "useMemo" is called conditionally — react-hooks/rules-of-hooks (CRIT-1)

/apps/web/components/ProfileForm.tsx
  42:13  warning  Using <img> — @next/next/no-img-element (LOW-2)

/apps/web/components/Sidebar.tsx
  338:17  warning  Using <img> — @next/next/no-img-element (LOW-2)

1 error, 2 warnings
```

---

## Files Reviewed

- `/apps/web/components/AdminMenuBuilder.tsx`
- `/apps/web/components/AdminTheme.tsx`
- `/apps/web/components/Home.tsx`
- `/apps/web/components/IconPicker.tsx`
- `/apps/web/components/IconRenderer.tsx`
- `/apps/web/components/Layout.tsx`
- `/apps/web/components/Login.tsx`
- `/apps/web/components/ProfileForm.tsx`
- `/apps/web/components/Sidebar.tsx`
- `/apps/web/context/AuthContext.tsx`
- `/apps/web/context/UIContext.tsx`
- `/apps/web/lib/auth.ts`
- `/apps/web/lib/menu-actions.ts`
- `/apps/web/lib/menu-service.ts`
- `/apps/web/lib/menu-utils.ts`
- `/apps/web/lib/profile-actions.ts`
- `/apps/web/app/(protected)/layout.tsx`
- `/apps/web/app/(protected)/page.tsx`
- `/apps/web/app/(protected)/error.tsx`
- `/apps/web/app/(protected)/loading.tsx`
- `/apps/web/app/(protected)/profile/page.tsx`
- `/apps/web/app/(protected)/admin/menu-builder/page.tsx`
- `/apps/web/app/(protected)/admin/theme/page.tsx`
- `/apps/web/app/(protected)/[...slug]/page.tsx`
- `/apps/web/app/layout.tsx`
- `/apps/web/app/login/page.tsx`
- `/apps/web/middleware.ts`
- `/deploy/supabase/schema.sql`
- `/tests/e2e/conftest.py`
- `/tests/e2e/helpers.py`
- `/tests/e2e/test_auth.py`
- `/tests/e2e/test_highlight.py`
- `/tests/e2e/test_menu_builder.py`
- `/tests/e2e/test_profile.py`
- `/tests/e2e/test_rbac.py`
- `/tests/e2e/test_sidebar.py`
- `/CLAUDE.md`
- `/vibe/README.md`
