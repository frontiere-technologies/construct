# RBAC Phase 1 — Roles & Permissions — Design Spec

**Date:** 2026-06-28
**Branch:** `feature/rbac` (continues from Phase 0)
**Builds on:** `docs/superpowers/specs/2026-06-28-rbac-module-design.md` (overall RBAC spec, §5) and the completed Phase 0 foundation.
**Target:** `sources/microservices/web-construct/`

---

## Summary

Phase 1 delivers the **Roles & Permissions** admin area (`/rolesPermissions`): a paginated roles list, role create/rename/delete, and a per-role permission editor (`PermissionsTree`) over the `navigation_item` tree. It also builds the two shared UI primitives (`DataTable`, `NavigationTree`) deferred from Phase 0, which Phases 2–3 will reuse.

This phase is where permission **grant semantics** become real, so it resolves two Phase-0 carry-forwards: CARRY-1 (orphaned-child) via auto-authorize-ancestors + a defensive adapter drop, and CARRY-2 (non-admin baseline) by confirming the strictly-gated behavior is intended (no change).

### Key decisions

- [x] ✅ ID=DEC-P1-1, Title=Cascade semantics — category toggle cascades to all descendants; leaf grant auto-authorizes ancestor categories; leaf revoke leaves ancestors untouched. (Resolves CARRY-1.)
- [x] ✅ ID=DEC-P1-2, Title=Sidebar adapter drops orphans defensively — `mapNavigationToSidebar` drops any item whose `parentId` is not in the emitted set. (Belt-and-suspenders for CARRY-1.)
- [x] ✅ ID=DEC-P1-3, Title=Non-admin sidebar stays strictly gated — no universally-visible Home; CARRY-2 closed as intended (the user/profile/theme panel is the always-present baseline).
- [x] ✅ ID=DEC-P1-4, Title=`role_item` holds the granted set — `updateRolePermissions` upserts `authorized=true` rows for grants and DELETEs rows for revokes; `hasPermissions` = "role has any `role_item` row".
- [x] ✅ ID=DEC-P1-5, Title=Leaf-OFF does not auto-clean now-empty categories (harmless; admin can turn the category off explicitly).
- [x] ✅ ID=DEC-P1-6, Title=Shared `DataTable` is controlled/presentational — the page owns server-side fetching/paging; the primitive emits state-change callbacks and never fetches.
- [x] ✅ ID=DEC-P1-7, Title=`NavigationTree` is built generic now (no drag-and-drop logic — just a hook point Phase 2 fills).
- [x] ✅ ID=DEC-P1-8, Title=Editability matrix enforced server-side AND in UI — SYSTEM: no rename/perms/delete; SERVICE: all; SYNCED: perms+delete, name read-only.
- [x] ✅ ID=DEC-P1-9, Title=Cascade/delta logic extracted as pure functions and unit-tested (the key quality lever).

---

## 1. Architecture

Same patterns as Phase 0: Server Components fetch via `createAdminClient()`; Client Components handle interaction; mutations are server actions in `lib/rbac/*-actions.ts`, each calling `requireAdmin()` (Phase 0). Read-side helpers in `lib/rbac/*-service.ts`, `cache()`-wrapped.

### File structure

**Created:**
- `lib/rbac/roles-service.ts` — `listRoles`, `countRoles`, `getAllRoles`, `getRole`, `getRoleAuthorizationTree`.
- `lib/rbac/roles-actions.ts` — `createRole`, `renameRole`, `updateRolePermissions`, `deleteRole`.
- `lib/rbac/permission-tree.ts` — PURE cascade/delta helpers (`buildAuthMap`, `applyToggle`, `computeDeltas`) + types.
- `lib/rbac/permission-tree.test.ts` — unit tests for the pure helpers.
- `components/rbac/DataTable.tsx` — generic controlled table primitive.
- `components/rbac/NavigationTree.tsx` — generic recursive tree primitive.
- `components/rbac/PermissionsTree.tsx` — wraps `NavigationTree` with the toggle + local delta map.
- `components/rbac/roles/RolesTableClient.tsx` — list page client (uses `DataTable`).
- `components/rbac/roles/RoleDetailClient.tsx` — detail page client (tabs + `PermissionsTree` + edit/save).
- `components/rbac/roles/CreateRoleModal.tsx`, `components/rbac/roles/RenameRoleModal.tsx`.
- `app/(protected)/rolesPermissions/page.tsx` — list (Server Component).
- `app/(protected)/rolesPermissions/[roleId]/page.tsx` — detail (Server Component).

**Modified:**
- `lib/rbac/types.ts` — add `RolePageItemDto`, `RoleInformationDto`, `UserNavigationTreeDto`, `RoleType`, `PermissionDelta`.
- `lib/rbac/sidebar-adapter.ts` — add orphan-drop pass (DEC-P1-2) + unit test.

---

## 2. Shared primitives

### 2.1 `DataTable` (controlled, presentational)

Generic over a column config and a row type. **Owns no data fetching** (DEC-P1-6). Props:
- `columns`: `{ key, header, sortable?, render?(row), hidden? }[]`
- `rows`: current page's rows
- `sort`: `{ field, direction }`; `onSortChange(field)`
- `page`/`totalPages`; `onPageChange(page)`
- `search`: string; `onSearchChange(value)` (the page debounces or passes through)
- `filtersSlot`: React node rendered in the "Filtri" drawer (area-specific)
- `columnToggle`: managed internally (show/hide via "Colonne") over `columns`
- `rowMenu?(row)`: items for the `⋯` menu; `onRowClick?(row)`
Renders: toolbar (search left; Colonne + Filtri + optional action button right), sortable header row, body, numbered pagination (`[1][2][3][…][N][›]`, current highlighted).

### 2.2 `NavigationTree` (generic recursive)

Props:
- `nodes`: `UserNavigationTreeDto[]`
- `renderTrailing?(node)`: trailing control per row (a toggle in Phase 1; action buttons in Phase 2)
- `expandedByDefault?`: boolean; internal expand/collapse state per category
- `dragHandle?`: boolean (Phase 1: false — the hook point exists but no DnD logic)
- indentation by depth; categories show a chevron expand/collapse.

---

## 3. Permission semantics (pure logic — `lib/rbac/permission-tree.ts`)

State held while editing: a `Map<number, boolean>` of the role's per-item authorization, seeded from the loaded tree, then mutated by toggles. The pure helpers:

- `buildAuthMap(trees: UserNavigationTreeDto[]): Map<number, boolean>` — flattens both root trees into `{idItem → authorization}` (the loaded baseline).
- `applyToggle(trees, map, itemId, on): Map<number,boolean>` — returns a new map with the cascade applied:
  - target is a **category**: set target + every descendant to `on`.
  - target is a **leaf**, `on === true`: set target true **and every ancestor category true**.
  - target is a **leaf**, `on === false`: set only the target false.
- `computeDeltas(loaded, current): PermissionDelta[]` — `{ idItem, authorization }[]` for every id whose `current` value differs from `loaded` (minimal delta).

`PermissionDelta = { idItem: number; authorization: boolean }`.

These are unit-tested exhaustively (DEC-P1-9): category-cascade-down (on/off), leaf-grant-authorizes-ancestors, leaf-revoke-leaves-ancestors, delta minimization (no-op toggles produce no delta), and idempotent re-toggle.

### 3.1 Sidebar adapter orphan-drop (DEC-P1-2)

`mapNavigationToSidebar` gains a final pass: build the set of emitted ids; drop any emitted item whose `parentId` (non-null) is not in that set. Add a unit test: an authorized leaf whose parent is unauthorized is omitted. (With auto-authorize-ancestors this shouldn't occur, but the adapter stays self-consistent.)

---

## 4. Server actions & read-side

All actions call `requireAdmin()`. Editability enforced server-side per the matrix (DEC-P1-8).

**`lib/rbac/roles-actions.ts`:**
- `createRole(roleName: string): Promise<{ id: number }>` — inserts a `role` with `id_role_type = 2` (SERVICE). Validates non-empty name.
- `renameRole(roleId: number, roleName: string): Promise<void>` — rejects unless the role is SERVICE; updates `description`.
- `updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void>` — rejects if role is SYSTEM. For `authorization=true` deltas: upsert `role_item(roleId, idItem, true)`. For `authorization=false` deltas: delete `role_item(roleId, idItem)`. Batch; surface any error (no partial-success reported as success).
- `deleteRole(roleId: number): Promise<void>` — rejects if role is SYSTEM. Deletes the `role` row (BEFORE DELETE trigger archives to `role_history`; `user_role` rows cascade).

**`lib/rbac/roles-service.ts`:**
- `listRoles(query): Promise<{ pagination, elements: RolePageItemDto[] }>` — server-side page/size/sort/search/filter. `sort ∈ {id, description, associatedUsers, dateIns, dateMod}`; `search` on `description`; filters: `hasPermission?: boolean`, `startDateIns?`, `endDateIns?`. Computes `associatedUsers` (count from `user_role`) and `hasPermissions` (exists `role_item`) per role.
- `countRoles(query): Promise<number>` — same filters minus paging.
- `getAllRoles(roleTypes?: RoleType[]): Promise<{ id, description }[]>` — for dropdowns.
- `getRole(roleId): Promise<RoleInformationDto>`.
- `getRoleAuthorizationTree(roleId, rootName: 'ROOT'|'OPERATIONS'): Promise<UserNavigationTreeDto[]>` — the subtree under the named root with `authorization` per node from `role_item`.

> **Implementation note:** sorting by `associatedUsers` and the `hasPermissions` filter require aggregating `user_role`/`role_item`. Implement via a SQL view or RPC if the Supabase query builder can't express the sort cleanly; document whichever is used.

---

## 5. Pages & UI

### 5.1 List — `/rolesPermissions`
Server Component fetches the first page via `listRoles` + `getAllRoles` (for filters); renders `RolesTableClient` (uses `DataTable`).
- Columns: ID, Name, Associated users, Has-permissions badge (Sì/No), Created, Updated — all sortable.
- Toolbar: search (name), Colonne, Filtri (has-permissions toggle + created date-range), **"New role"**.
- Row click → `/rolesPermissions/{id}`. Row `⋯`: Rename (only if SERVICE), Delete (only if SERVICE/SYNCED, with confirm).
- "New role" → `CreateRoleModal` → `createRole` → redirect to `/rolesPermissions/{newId}`.

### 5.2 Detail — `/rolesPermissions/[roleId]`
Server Component loads `getRole` + `getRoleAuthorizationTree(id,'ROOT')` + `getRoleAuthorizationTree(id,'OPERATIONS')`; renders `RoleDetailClient`.
- Breadcrumb "Ruoli & permessi / Dettagli"; header `#{id} {name}` + `{N} associated users`.
- Pencil-rename icon only when SERVICE → `RenameRoleModal` → `renameRole`.
- "Edit" button disabled w/ tooltip when SYSTEM; in edit mode show "Annulla"/"Salva".
- Tabs: **Sezioni** (ROOT) and **Operazioni** (OPERATIONS). Each renders `PermissionsTree`.
- `PermissionsTree`: view mode → toggles disabled; edit mode → toggles drive the local map via `applyToggle`; "Salva" → `computeDeltas` → `updateRolePermissions` → exit edit + refresh; "Annulla" → discard map.

---

## 6. Data model (DTOs — extend `lib/rbac/types.ts`)

- `RoleType = 'SYSTEM' | 'SERVICE' | 'SYNCED'`
- `RolePageItemDto = { id, description, associatedUsers, hasPermissions, dateIns, dateMod, roleType }`
- `RoleInformationDto = { id, roleName, associatedUsersCount, roleType }`
- `UserNavigationTreeDto` = the recursive node shape from the overall spec §4.3 (`id, name, description, type, functionalityType, link, navbarPosition, parentId, icon, translations, authorization, noPermissionNeedForNavigation, clickCount, tagTranslations, children`). For Phase 1 only the fields the tree/permissions UI uses need populating: `id, name, type, parentId, authorization, children` (+ translated label).
- `PermissionDelta = { idItem: number; authorization: boolean }`

---

## 7. Testing

- [ ] **Unit (vitest)** — `permission-tree.test.ts`: category cascade down (on/off), leaf grant auto-authorizes ancestors, leaf revoke leaves ancestors, delta minimization, idempotent re-toggle. `sidebar-adapter` orphan-drop case.
- [ ] **E2E (pytest/Playwright)** — create role → appears in list; rename a SERVICE role; open a role, toggle permissions, Salva, reload → persists; SYSTEM role shows Edit disabled (no toggle); delete a SERVICE role → gone from list. Run against the dev server (`AUTH_TEST_CREDENTIALS=true`) as in Phase 0.
- [ ] **Browser verification** — the detail tree renders, toggles cascade visibly, save round-trips.

---

## 8. Out of scope (later phases)
- Functionalities CRUD + drag-and-drop (Phase 2 — fills `NavigationTree`'s drag hook; also closes CARRY-3 SVG sanitization and CARRY-4 immutable-delete guard).
- Users area + role assignment (Phase 3).
- Enforcement of the granular OPERATIONS permissions (USER_*/PERMISSION_*) at call sites — the Operazioni tab lets admins grant them now, but wiring them to actual operations is later.
