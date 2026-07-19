# AG Grid Community Migration — Design Spec

**Date:** 2026-07-19
**Branch:** `feature/ag-grid`
**Target:** `sources/microservices/web-construct/`
**Source requirement:** user request — adopt AG Grid Community for all present and future data tables (base filters, sorting, column resize, and other free-tier features per https://www.ag-grid.com/license-pricing/ and https://www.ag-grid.com/javascript-data-grid/grid-api/).

---

## Summary

The app has exactly one reusable table primitive today, `components/rbac/DataTable.tsx` (plain HTML `<table>`), consumed by two pages: Users (`user-management`) and Roles (`roles-permissions`). Both are Server Components that read `searchParams`, call a Drizzle-backed service function (`listUsers`/`listRoles`) with page/sort/filter, and pass fully-resolved rows down to a `'use client'` wrapper (`UsersTableClient`/`RolesTableClient`) that renders `DataTable` with a slide-over `FilterDrawer` for filters.

This spec replaces `DataTable` with **AG Grid Community** for these two tables, migrating them now (not just building a wrapper for future use), and establishes the reusable grid component future tables will build on. Hierarchical/tree UIs (`NavigationTree`, `PermissionsTree`, `FunctionalitiesTreeClient`) are explicitly out of scope — they are not flat tables, and AG Grid's Tree Data feature is Enterprise-only.

### Key decisions (confirmed with user)

- [x] DEC-1 — Migrate Users and Roles to AG Grid now, in this same effort (not a future-only wrapper).
- [x] DEC-2 — Use the **Infinite Row Model** (Community-licensed), not the Client-Side Row Model: the existing server-side pagination/sort/filter (Drizzle `LIMIT`/`OFFSET`, `applyUserFilters`/`applyFilters`) is preserved and driven by an AG Grid `datasource`, not replaced by "load everything once."
- [x] DEC-3 — Pagination UX becomes **infinite scroll** (no numbered page buttons). There is no discrete "page" concept in the URL going forward.
- [x] DEC-4 — Filters move from the custom `FilterDrawer` panel to **AG Grid's native per-column filters** (text filter for free-text fields, custom `IFilterComp` implementations for enum fields: Ruolo, Stato, Ha permessi). `FilterDrawer.tsx` and `CustomSelect.tsx` are **not deleted** — `FilterDrawer` is still used by `FunctionalitiesTreeClient`.
- [x] DEC-5 — **Filter and sort state stay synced to the URL** (shareable links, browser back/forward), even though the row model and filter UI are different. Only `page=` is dropped from the URL (superseded by infinite scroll).
- [x] DEC-6 — AG Grid's Theming API (v33+, no legacy CSS-theme imports) is wired to the app's existing `--theme-*` CSS custom properties, so the grid follows the live, admin-editable theme automatically.
- [x] DEC-7 — Existing e2e coverage (`test_users.py`, `test_roles.py`, ~15 tests) will be **rewritten**, not patched — their selectors (`FilterDrawer` test-ids, `tbody tr`, fixed-page-size row counts) don't survive the migration. This is called out as an explicit, sized task rather than a follow-on surprise.

---

## 1. Dependencies

Add to `sources/microservices/web-construct/package.json`:
- `ag-grid-community`
- `ag-grid-react`

Pin to the latest stable release at implementation time (Theming API, v33+). No `ag-grid-enterprise`.

## 2. Shared component — `components/ui/DataGrid.tsx`

New generic wrapper around `<AgGridReact<T> />`, the component future tables will also use:
- Accepts `columnDefs: ColDef<T>[]`, a `datasource: IDatasource`, `getRowId`, an optional actions-column config, and an optional primary action button (parity with `DataTable`'s `actionButton`).
- Sets Community-safe defaults on `defaultColDef`: `resizable: true`, `sortable: true`, `filter: true` (per-column overridden for custom enum filters).
- `rowModelType="infinite"`, `pagination` **not** set (infinite scroll per DEC-3), `cacheBlockSize` ~50, bounded `maxBlocksInCache`.
- Applies the shared theme (§5) via the `theme` prop.
- Hosts the column-visibility toggle (§4) and the shared row-actions cell renderer (§4).

`UsersTableClient` and `RolesTableClient` are rewritten to render `DataGrid` instead of `DataTable`.

## 3. Data layer — Infinite Row Model + Server Actions

> **Addendum (post-implementation, Task 18):** row-fetching ended up going through plain
> Route Handlers (`app/api/rbac/users-grid`, `app/api/rbac/roles-grid`) called via `fetch()`
> from the datasources, **not** the `'use server'` Server Actions originally planned below.
> Root cause: Server Actions share the App Router's action queue with `router.push()` (used
> for URL sync, §3 "URL sync (DEC-5)"); a `router.push()` firing close to a pending grid-fetch
> action could mark it `discarded`, silently hanging the datasource forever (see commit
> `d1955a3`, "fix(rbac): route AG Grid row-fetching through Route Handlers, not Server
> Actions"). Route Handlers never touch that queue, closing the race by construction. This is
> an implementation-detail change only — it doesn't affect DEC-1..DEC-7 themselves.

- New server actions wrapping the existing service calls — no change to `listUsers`/`listRoles`/`applyUserFilters`/`applyFilters`/Drizzle query logic itself:
  - `lib/rbac/users-actions.ts`: `fetchUsersGridPage(params)` → calls `listUsers(query)`.
  - `lib/rbac/roles-actions.ts`: `fetchRolesGridPage(params)` → calls `listRoles(query)` (or equivalent existing roles list function).
- Client-side `datasource: IDatasource` (one per table) implements `getRows({ startRow, endRow, sortModel, filterModel, successCallback, failCallback })`:
  - `startRow/endRow` → `page/size` (block size from §2).
  - `sortModel` (AG Grid `colId` + direction) → existing `sort/direction` query shape (reuse `USER_SORT_COLUMN`-style mapping).
  - `filterModel` (per column) → existing filter query fields: `search`, `statuses`, `roleIds`, `createdFrom`/`createdTo` (Users); `search`, `hasPermission`, `startDateIns`/`endDateIns` (Roles).
  - On error, calls `failCallback()`; on success, `successCallback(rows, lastRowIndex)` (or `-1`/undefined when more rows may exist, per AG Grid infinite model contract).
- `page.tsx` for both routes is simplified: no longer parses `searchParams` to fetch rows server-side. `user-management/page.tsx` still does one server fetch for `allRoles` (needed for the Ruolo filter's option list); `roles-permissions/page.tsx` needs no server-side list fetch at all beyond what's already required for other page chrome.

### URL sync (DEC-5)

- On `onGridReady`, read the initial `searchParams` (still passed as props from the Server Component, same shape as today minus `page`) and call `api.setFilterModel(...)` + `api.applyColumnState({ state: [...] })` **before** the grid's first `getRows` fires, so only one initial fetch happens.
- On `onFilterChanged`/`onSortChanged`, read `api.getFilterModel()`/`api.getColumnState()`, serialize to the same query param names used today (`search`, `statuses`, `roleIds`, `createdFrom`/`createdTo`, `hasPermission`, `startDateIns`/`endDateIns`, `sort`, `direction`), and `router.push` — one history entry per explicit user action (an "Applica" on a filter, a header-sort click), matching current behavior.
- Text filters use `filterParams: { buttons: ['apply', 'reset'] }` so typing doesn't spam history entries or refetch per keystroke.
- Browser back/forward changes `searchParams` externally; the component reacts by re-applying `setFilterModel`/`applyColumnState`, which AG Grid translates into a new `getRows`.
- No `page=` param — infinite scroll has no discrete page to persist (DEC-3).

## 4. Filters, row actions, columns

- **Free-text fields** (Utente/Email search, Nome ruolo search): AG Grid's built-in text filter, `buttons: ['apply', 'reset']`.
- **Enum fields** (Ruolo, Stato, Ha permessi): custom `IFilterComp` components (Community-legal — custom filters are core API, not Enterprise) presenting a dropdown of options, conceptually replacing `CustomSelect`'s role in the old `FilterDrawer`.
- **Date range** (Creato / Data di creazione): AG Grid date filter or a small custom range filter component, feeding `createdFrom/To` / `startDateIns/endDateIns`.
- **Actions column**: a shared cell renderer (e.g. `components/rbac/GridRowActionsMenu.tsx`) reproducing today's portal-positioned dropdown menu logic currently inline in `DataTable.tsx` — "Gestisci ruoli" for Users; "Rinomina"/"Elimina" (with existing `disabled` rules keyed off `roleType`) for Roles.
- **Column visibility toggle**: small custom dropdown driven by `columnApi.setColumnsVisible()` (Community API; AG Grid's built-in "Columns" tool panel UI is Enterprise-only, so we keep a bespoke trigger button, same UX as today's "Colonne" dropdown).
- Row click → navigation (Roles → role detail page) via `onRowClicked`.
- Status toggle (Users) stays an inline control inside the Stato cell renderer, same as today.

## 5. Theming

> **Addendum (post-implementation, Task 18):** the remap ended up living in
> `components/ui/dataGridConfig.ts` as `themeQuartz.withParams({ backgroundColor:
> 'var(--theme-surface)', accentColor: 'var(--theme-primary)', ... })`, passed through
> `DataGrid`'s `theme` prop — **not** a separate `app/ag-grid-theme.css` remap file as
> originally sketched below. Same outcome (DEC-6 unaffected): AG Grid's Theming API params
> reference the app's `--theme-*` custom properties directly, so `AdminTheme` edits and
> light/dark switching still apply live with no extra JS or a reload (verified in Task 18's
> manual pass — changing the primary/surface color pickers updates both grids immediately).
> It's just a simpler single-file mechanism than the two-file (JS params + remap CSS) split
> described below.

- Base theme: `themeQuartz` via AG Grid's Theming API, passed through the `theme` prop on `DataGrid` — no legacy `ag-theme-*` CSS imports.
- A small CSS block (new `app/ag-grid-theme.css`, imported once globally) remaps AG Grid's generated custom properties to the app's existing tokens, e.g.:
  - `--ag-background-color` / `--ag-foreground-color` ← `--theme-surface` / (existing text token)
  - `--ag-border-color` ← `--theme-border`
  - `--ag-accent-color` ← `--theme-primary`
  - `--ag-row-hover-color` ← `--theme-surface-hover`
- Because these are live CSS custom properties, the grid follows `AdminTheme`'s runtime theme edits and light/dark switching with no extra JS.

## 6. Per-table migration mapping

**Users** (`UsersTableClient.tsx`, `app/(protected)/user-management/page.tsx`):
- Columns: Utente, Email, Ruoli, Stato, Creato, Aggiornato — same rendering (full name fallback to email, role names joined, `StatusBadge`, locale date formatting).
- Filters: text (Utente/Email), enum (Ruolo from `allRoles`, Stato), date range (Creato).
- Row action: "Gestisci ruoli" → opens existing `ManageRolesModal` unchanged.
- Status toggle: unchanged `setUserStatus` server action + `confirm()` flow.

**Roles** (`RolesTableClient.tsx`, `app/(protected)/roles-permissions/page.tsx`):
- Columns: ID, Nome ruolo, Utenti associati, Ha permessi, Data di creazione, Ultimo aggiornamento — same rendering (badge for Ha permessi, `fmtDate`).
- Filters: text (Nome ruolo), enum boolean (Ha permessi), date range (Data di creazione).
- Row click → `/roles-permissions/[roleId]`.
- Row actions: "Rinomina" (disabled unless `roleType === 'SERVICE'`) → `RenameRoleModal`; "Elimina" (disabled if `roleType === 'SYSTEM'`) → `deleteRole` + `confirm()`.
- Primary action button: "Nuovo ruolo" → `CreateRoleModal`, unchanged.

## 7. Out of scope

- `NavigationTree.tsx`, `PermissionsTree.tsx`, `FunctionalitiesTreeClient.tsx` — hierarchical tree UIs, not flat tables; AG Grid Tree Data is Enterprise-only. `FilterDrawer.tsx` stays in place for `FunctionalitiesTreeClient`'s use.
- Deleting `DataTable.tsx`, `FilterDrawer.tsx`, or `CustomSelect.tsx` — they remain in the tree (still referenced outside Users/Roles, or kept as a reference pattern for the custom enum filter components). Unused imports specific to the migrated tables should be pruned during implementation.
- Any AG Grid Enterprise feature (Set Filter, Server-Side Row Model, Tree Data, tool panels, Excel export, range selection charts, etc.).
- Persisting infinite-scroll position in the URL (only sort + filters are synced, per DEC-3/DEC-5).

## 8. Testing

- `sources/tests/e2e/test_users.py`, `test_roles.py`: full rewrite against AG Grid's DOM (header filter icons/popups, `.ag-row`/`.ag-cell`, no `tbody tr`) and against the new semantics (no fixed page-size baseline count; scroll-triggered row loading; URL params without `page=`). Cover: column filters (text + each custom enum filter + date range), sort, infinite scroll loading more rows, row actions (Gestisci ruoli / Rinomina / Elimina / status toggle), row click navigation, URL sync + browser back/forward, column visibility toggle.
- Add/adjust Vitest unit tests for the new custom filter components and the `datasource`/URL-serialization mapping logic (currently untested since `DataTable`/`UsersTableClient`/`RolesTableClient` have no existing `.test.ts(x)` files).
- `tsc --noEmit` and `npm run lint`.
- Manual browser verification (per project convention): both tables load, sort each sortable column, apply/reset each filter type, scroll to trigger more rows, row actions and modals, row click navigation, column visibility toggle, and a live theme change (via `AdminTheme`) reflected in the grid.
