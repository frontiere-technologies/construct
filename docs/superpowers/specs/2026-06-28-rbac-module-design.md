# RBAC Module — Design Spec

**Date:** 2026-06-28
**Branch:** `feature/rbac`
**Source spec:** `docs/input-specs/users-roles-functionalities/users-roles-functionalities-specs.md` (reverse-engineered from a Java Spring Boot + Next.js system)
**Target:** `sources/microservices/web-construct/` (React 19 + Next.js 16 App Router + NextAuth v5 + Supabase + Tailwind v4)

---

## Summary

Port the original system's RBAC module (three admin areas — **Users**, **Functionalities**, **Roles & Permissions**) into construct, adapting a Java REST + external-IDP design to construct's Next.js + Supabase + NextAuth stack.

The central decision is **full unification**: the construct app already has a simpler `menu_items` table (drives the sidebar) and a single `role` string on `users`. The original system's `navigation_item` and N:N role model are the richer, canonical versions of these. So `navigation_item` **replaces** `menu_items` and becomes the single source for both the sidebar and permissions; the N:N `role`/`user_role`/`role_item` model **replaces** the single `role` string.

### Key decisions

- [x] ✅ ID=DEC-1, Title=Full unification — `navigation_item` replaces `menu_items`; N:N roles replace the single `role` string. The old Menu Builder is removed.
- [x] ✅ ID=DEC-2, Title=Data-only i18n — translation **data** is stored/edited in all 9 languages per the model; the admin UI chrome stays single-language; no new i18n framework.
- [x] ✅ ID=DEC-3, Title=Drop multitenancy — `tenantValidationPending`/`multiTenancyEnabled` are constant `false` in DTOs; no tenant tables.
- [x] ✅ ID=DEC-4, Title=Simplify `role_item` to `(id_role, id_item, authorized)` — the 4 CRUD columns are vestigial (UI + `PUT /role/{id}` only ever manage one `authorization` flag); granularity comes from PERMISSION-type items under `operations`.
- [x] ✅ ID=DEC-5, Title=Drop `external_system` — referenced but unused by all three areas (YAGNI).
- [x] ✅ ID=DEC-6, Title=Identity = extend existing `users` (keep `uuid` PK), add RBAC fields + tables; do not adopt the spec's numeric `id_user`.
- [x] ✅ ID=DEC-7, Title=Backend = Next.js server actions over Supabase `createAdminClient()`; no separate REST layer.
- [x] ✅ ID=DEC-8, Title=`isAdmin` (has role id 1) replaces the `role` string in the session/JWT.
- [x] ✅ ID=DEC-9, Title=Forms render all 9 languages (EN, IT, DE, FR, ES, NL, PT, SK, RO); EN/IT expanded by default, rest collapsed.
- [x] ✅ ID=DEC-10, Title=Omit the optional "Batch Patch" button (YAGNI).

---

## 1. Architecture

- **Data layer:** Supabase (PostgreSQL). RLS enabled on every table; all access via `createAdminClient()` (service_role, server-only) — consistent with the existing schema. Schema lives in `sources/devops/db/schema.sql`.
- **Backend:** Next.js **server actions** + route handlers. Each action re-checks authorization server-side. No REST API.
- **Frontend:** Server Components fetch data; Client Components handle interaction. Pages under `app/(protected)/` (middleware-protected).
- **Code layout:**
  - `lib/rbac/types.ts` — DTOs
  - `lib/rbac/auth-guard.ts` — `requireAdmin()`
  - `lib/rbac/users-actions.ts`, `roles-actions.ts`, `navigation-actions.ts` — server actions
  - `lib/rbac/navigation-service.ts` — read-side helpers (sidebar derivation, tree assembly), `cache()`-wrapped
  - `components/rbac/DataTable.tsx`, `components/rbac/NavigationTree.tsx` — reusable primitives
  - `app/(protected)/userManagement/`, `app/(protected)/functionalities/`, `app/(protected)/rolesPermissions/`

---

## 2. Data model & schema

Extends `sources/devops/db/schema.sql`. Conventions kept: RLS-on, `set_updated_at` triggers, idempotent seeds (`on conflict do nothing`).

### 2.1 Identity (extend existing `users`)

Keep `users` and its `uuid` PK (already FK'd by `password_set_tokens`, provisioned by NextAuth). Add nullable columns: `sub`, `country` (char(3)), `branch`, `flow`, `uom_role`, `additional_company`, `owner_company`, `features`, `picture_url`, `id_user_status` (default 2), `last_status_ts`. The existing `role` string column is dropped **after** the migration backfill (Phase 0 cutover).

- `user_status` lookup: `1=Deactivated`, `2=Active`.
- `user_info`: `(user_id uuid, attribute_type text, attribute_value text, …)`, PK `(user_id, attribute_type)`.

### 2.2 Roles

- `role`: `id bigint PK`, `id_role_type bigint`, `description text not null`, timestamps. System rows seeded with explicit ids (0,1,2); others via identity.
- `role_type` lookup: `1=SYSTEM`, `2=SERVICE`, `3=SYNCED`.
- `role_history`: append-only `(id_role, h_date_ins, description, date_ins, date_mod)`. Populated by a `BEFORE DELETE` trigger on `role` (faithful to spec).
- `user_role`: `(user_id uuid → users.id, id_role bigint → role.id)` PK both, `date_ins`. `ON DELETE CASCADE` from both sides.

### 2.3 Navigation (`navigation_item` replaces `menu_items`)

```
navigation_item (
  id_item                          bigint PRIMARY KEY,   -- explicit for system rows (incl. 0, -1), identity for the rest
  name                             text,
  id_item_type                     bigint NOT NULL REFERENCES navigation_item_type,   -- 1=CATEGORY, 2=FUNCTIONALITY
  id_functionality_type            bigint REFERENCES functionality_type,              -- null for categories
  functionality_link               text,
  icon_path                        text,                  -- SVG inline
  id_item_parent                   bigint REFERENCES navigation_item(id_item),
  order_position                   integer NOT NULL DEFAULT 0,
  description                      text,
  navbar_position                  text CHECK (navbar_position IN ('TOP','BOTTOM')),  -- null = not pinned
  item_translation                 jsonb,                 -- {"IT":{"name","description"}, ... 9 langs}
  is_immutable                     smallint NOT NULL DEFAULT 0,
  config_visibility                smallint NOT NULL DEFAULT 0,
  no_permission_need_for_navigation smallint NOT NULL DEFAULT 0,
  external_id                      text,
  click_count                      bigint DEFAULT 0,
  created_at, updated_at
)
```

- `navigation_item_type` lookup: `1=CATEGORY`, `2=FUNCTIONALITY`.
- `functionality_type` lookup: `1=EMBEDDED_PAGE`, `2=EXTERNAL_LINK`, `3=INTERNAL_FUNCTIONALITY`, `4=REMOTE_DESKTOP`, `5=PERMISSION`.
- `navigation_item_tag`: `(id_item, tag_lan, tag)` PK all three.

> System ids include **0 (`root`)** and **-1 (`operations`)**. Because `bigint identity` won't generate these, system rows are inserted with explicit ids and the identity sequence is set to start above the max seeded id.

### 2.4 Permissions

- `role_item`: `(id_role bigint → role.id, id_item bigint → navigation_item.id_item, authorized boolean NOT NULL DEFAULT false)`, PK `(id_role, id_item)`. (DEC-4: single flag.)

### 2.5 Removed

- `menu_items` table, its seed, and `update_menu_orders` RPC — superseded by `navigation_item`.
- No `external_system` table (DEC-5).

---

## 3. Authorization

### 3.1 Session / JWT

At login, the NextAuth `jwt` callback resolves the user's roles from `user_role` and writes to the token:
- `roleIds: number[]`
- `isAdmin: boolean` (= `roleIds.includes(1)`)

The `session` callback exposes both on `session.user`. The `role` string is replaced (DEC-8). New users get `Registered user` (id 0) at first-login provisioning (in the existing `jwt` upsert path).

### 3.2 Middleware (`auth.config.ts`)

The current `/admin` admin gate generalizes: `/userManagement`, `/functionalities`, `/rolesPermissions` require `session.user.isAdmin`; non-admins redirect to `/`. Token-only (no DB), as today.

### 3.3 Server-side enforcement

Every RBAC action/handler calls `requireAdmin()` (`lib/rbac/auth-guard.ts`) — defense in depth. Mirrors today's `if (role !== 'admin') throw`.

### 3.4 Sidebar derivation

`Sidebar` reads `navigation_item` (not `menu_items`). A node renders for the current user when it is reachable via a `role_item` authorized for one of the user's roles **OR** `no_permission_need_for_navigation = 1`. Nodes under `operations`, or otherwise non-menu (e.g. PERMISSION type / `config_visibility=1`), never render. Administrator (all items authorized) sees everything. This satisfies the "functionalities tied to roles but not shown in any menu" generalization.

### 3.5 Bootstrap / migration (idempotent, Phase 0)

1. Seed roles 0/1/2.
2. For every existing `users` row → insert `user_role(Registered user)`.
3. For rows with `role='admin'` → also insert `user_role(Administrator)`.
4. After cutover, drop the `users.role` column.

Guarantees no lock-out.

### 3.6 Removed surface

`/admin/menu-builder` page, `AdminMenuBuilder.tsx`, `lib/menu-service.ts`, `lib/menu-actions.ts`, `lib/menu-utils.ts`, `types/menu.ts` are removed; the Admin sidebar entry is repointed. `/admin/theme` is untouched.

---

## 4. The three areas

Shared primitives built once:
- **`DataTable`** — sortable headers (toggle ASC/DESC), column show/hide ("Colonne"), filters drawer ("Filtri"), debounced search, numbered pagination, `⋯` row menu. Server-side paging/sorting/filtering.
- **`NavigationTree`** — recursive render, expand/collapse categories, drag handle, configurable per-row controls (action buttons vs permission toggle).

### 4.1 Users — `/userManagement`

- Table columns: User (first+last), Email, Created, Roles (comma-joined), Status badge (green Active / grey Deactivated), Updated (relative time). All sortable.
- Filters: roles multi-select (from `getAllRoles`), status multi-select, created date-range. Search on name+email.
- Row `⋯` → "Manage Roles" modal: multi-select checkbox dropdown, current roles prefilled; confirm → `updateUserRoles(userId, roleIds[])` (full **replace** via delete-then-insert in a transaction) → refresh.
- Actions: `listUsers(query)`, `countUsers(query)`, `updateUserRoles(userId, roleIds)`.
- DTO `UserDTO`: per source spec §3.3, with `tenantValidationPending`/`multiTenancyEnabled` = constant `false`.

### 4.2 Functionalities — `/functionalities`

- Tabs per root: `root` → "Tutto", `operations` → its translated name, extensible to future roots.
- Tree from `getNavigationSubtree(root)`; categories expand/collapse; drag handle → `moveNavigationItem(itemId, targetParentId, orderPosition)`.
- CATEGORY row: `+` (create child) / `✎` / `🗑`. FUNCTIONALITY row: `✎` / `🗑`. Delete is recursive with confirm; blocked when `is_immutable=1`.
- Create (`/functionalities/create?root=`) & Edit (`/functionalities/{id}/edit`): two-column layout.
  - **Left — General:** name (IT, required, ≤100), parent dropdown (`getParentList`), SVG icon upload + inline preview, description (IT, required, ≤500, counter), tags. **Settings:** radio Category/Functionality → when Functionality: type dropdown (5 types, required) + link (required).
  - **Right — Translations:** accordion per language, all **9** langs (EN/IT open, rest collapsed); each has name, description, tags.
  - "Create"/"Save" disabled until required fields valid.
- Actions: `getNavigationSubtree(root)`, `getNavigationItem(id)`, `createNavigationItem(body)`, `updateNavigationItem(id, body)`, `moveNavigationItem(id, target, pos)`, `deleteNavigationItem(id)`, `getParentList()`.
- DTO `UserNavigationTreeDto`: per source spec §4.3.

### 4.3 Roles & Permissions — `/rolesPermissions`

- List table: ID, Name, Associated users (count), Has-permissions badge (Sì/No), Created, Updated. Toolbar: search, Colonne, Filtri (has-permissions toggle, date range), **"New role"** → modal (`createRole(name)` → SERVICE → redirect to detail). Row `⋯`: Rename, Delete. Row click → detail.
- Detail (`/rolesPermissions/{id}`): breadcrumb; header `#{id} {name}` + `{N} associated users`; pencil-rename **only** when SERVICE; "Edit" disabled w/ tooltip when SYSTEM; tabs per root.
  - **PermissionsTree:** toggle per row. View mode → toggles disabled. Edit mode → toggles tracked in local `{itemId→authorized}` map; toggling a category cascades to descendants. Save sends **delta only** → `updateRolePermissions(roleId, deltas[])`. Cancel clears the map.
  - Editability matrix: SYSTEM ✗rename ✗perms ✗delete; SERVICE ✓✓✓; SYNCED ✗rename ✓perms ✓delete.
- Actions: `listRoles(query)`, `countRoles(query)`, `getAllRoles(roleTypes?)`, `getRole(id)`, `createRole(name)`, `renameRole(id, name)`, `updateRolePermissions(id, deltas)`, `getRoleAuthorizationTree(id, root)`, `deleteRole(id)` (trigger archives to `role_history`; `user_role` cascades).
- DTOs `RolePageItemDto`, `RoleInformationDto`: per source spec §5.4.

---

## 5. Seed data (idempotent, in `schema.sql`)

- `role_type`, `navigation_item_type`, `functionality_type`, `user_status` lookups.
- `role`: 0 Registered user (SYSTEM), 1 Administrator (SYSTEM), 2 Tenant Super Administrator (SYSTEM).
- `navigation_item`: -1 `operations`, 0 `root`, 1 Home, 2 RBAC, 3 Users→`userManagement`, 4 Functionalities→`functionalities`, 5 Roles & Permissions→`rolesPermissions` (3..5 under category 2, all `is_immutable=1`).
- 8 PERMISSION items under `operations`: USER_CREATE/READ/UPDATE/DELETE, PERMISSION_CREATE/READ/UPDATE/DELETE (`config_visibility=1, is_immutable=1`).
- `role_item`: Administrator (1) authorized on all seeded items.
- Migration block: backfill `user_role` (§3.5), then drop `users.role`.

---

## 6. Testing

Per project rule: **browser verification of every area** (build success is not enough) + E2E in Python via `uv run pytest` under `sources/tests/e2e/`.

- E2E happy paths: user role assignment; functionality create/edit/move/delete; role create/rename/permission-toggle-save/delete; sidebar reflects permissions.
- Unit coverage for non-trivial action logic: permission delta computation, recursive delete, role-replace transaction, sidebar derivation.

---

## 7. Phasing

- [ ] **Phase 0 — Foundation:** schema + seed + migration; auth/session rewire (`isAdmin`, `roleIds`); `requireAdmin`; remove old menu system; repoint sidebar to `navigation_item`; DTOs + `DataTable`/`NavigationTree` primitives.
- [ ] **Phase 1 — Roles & Permissions** (exercises tree + permissions end-to-end first).
- [ ] **Phase 2 — Functionalities** (richest forms).
- [ ] **Phase 3 — Users** (depends on roles existing).

Each phase: build → browser-verify → E2E → review.

---

## 8. Open incongruences resolved (traceability)

- [x] ✅ ID=INC-1, Title=`menu_items` vs `navigation_item` overlap → resolved by DEC-1 (unification).
- [x] ✅ ID=INC-2, Title=`role_item` 4 CRUD columns unused by UI → resolved by DEC-4 (single `authorized` flag; granularity via PERMISSION items).
- [x] ✅ ID=INC-3, Title=Multitenancy prepared-but-unused → resolved by DEC-3 (dropped).
- [x] ✅ ID=INC-4, Title=`external_system` referenced but unused → resolved by DEC-5 (dropped).
- [x] ✅ ID=INC-5, Title=External-IDP `sub`/numeric `id_user` vs NextAuth `uuid` users → resolved by DEC-6 (extend existing `users`).
- [x] ✅ ID=INC-6, Title=Form mockup shows 6 langs, data model 9 → resolved by DEC-9 (render all 9).
