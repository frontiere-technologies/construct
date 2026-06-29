# RBAC Phase 3 — Users — Design

**Date:** 2026-06-29
**Depends on:** Phase 0 (identity tables + `user_role` + seeded `userManagement` nav item), Phase 1 (`role` table, `DataTable` primitive, URL-state list pattern).
**Module design:** `docs/superpowers/specs/2026-06-28-rbac-module-design.md` §4.1.
**Source spec:** `docs/input-specs/users-roles-functionalities/users-roles-functionalities-specs.md` §3.

## 1. Overview

Phase 3 delivers the last RBAC admin area — **Users** (`/userManagement`): a searchable/filterable/sortable, paginated list of application users showing their roles and account status, with two mutations: **manage a user's roles** (full replace) and **activate/deactivate** a user. It reuses the Phase-1 `DataTable` primitive and the URL-search-params list pattern (`/rolesPermissions`). All reads go through a service using `createAdminClient()`; both mutations are `'use server'` actions guarded by `requireAdmin()` plus pure, unit-tested anti-lockout guardrails.

Out of scope: creating or deleting users (users originate from auth/registration), multitenancy (the DTO exposes `tenantValidationPending`/`multiTenancyEnabled` as constant `false`), and per-role granular editing (that is Phase 1).

## 2. Key Decisions

- [x] ✅ ID=DEC-P3-1, Title=Scope = roles + status — the area supports `listUsers`/`countUsers` (read) plus `updateUserRoles` and `setUserStatus`. No user create/delete.
- [x] ✅ ID=DEC-P3-2, Title=Status toggle on the badge — the Stato badge (green Active / grey Deactivated) is itself the clickable control that flips `id_user_status` (1↔2) via `setUserStatus`; no separate `⋯` menu item for it.
- [x] ✅ ID=DEC-P3-3, Title=Anti-lockout guardrails (pure, unit-tested) apply to BOTH mutations — see §5.
- [x] ✅ ID=DEC-P3-4, Title=Admin = `roleIds.includes(ROLE_ADMINISTRATOR)` — mirrors `computeIsAdmin` in `lib/rbac/auth-roles.ts`. `ROLE_ADMINISTRATOR=1`, `ROLE_REGISTERED=0` (from `lib/rbac/types.ts`). "Tenant Super Administrator" (id 2) does NOT grant app-admin and is not special-cased.
- [x] ✅ ID=DEC-P3-5, Title=Role display name = `role.description` — the `role` table stores the human name in `description` (no `name` column). Roles join: `user_role.user_id → users.id`, `user_role.id_role → role.id_role`.
- [x] ✅ ID=DEC-P3-6, Title=Read from `public.users` — the RBAC-extended app table (uuid PK), not `auth.users`. `updateUserRoles` replaces via delete-then-insert; reuse Phase-1's approach (the Phase-1 carry-forward CARRY-8 about atomicity applies equally and is NOT resolved here).
- [x] ✅ ID=DEC-P3-7, Title=`Registered user` (id 0) is never removable — every user keeps it (the auth jwt path re-adds it); the Manage-Roles modal shows it checked-and-disabled so it can't be unchecked.

## 3. File Structure

**Created:**
- `lib/rbac/user-guards.ts` (+`.test.ts`) — pure anti-lockout guard functions (§5).
- `lib/rbac/users-service.ts` — `listUsers`, `countUsers`, `getAllRoles` (read side).
- `lib/rbac/users-actions.ts` — `updateUserRoles`, `setUserStatus` (`'use server'`).
- `components/rbac/users/UsersTableClient.tsx` — table + toolbar (search, filters) + row actions, reusing `DataTable`.
- `components/rbac/users/ManageRolesModal.tsx` — multi-select role checkboxes.
- `components/rbac/users/StatusBadge.tsx` — clickable Active/Deactivated badge.
- `app/(protected)/userManagement/page.tsx` — Server Component.
- `sources/tests/e2e/test_users.py`.

**Modified:** `lib/rbac/types.ts` (add `UserDTO`, `UsersQuery`, `UserStatus`).

## 4. Data Model

```ts
export type UserStatusId = 1 | 2 // 1 Deactivated, 2 Active
export interface UserDTO {
  id: string                 // users.id (uuid)
  firstName: string | null
  lastName: string | null
  email: string
  createdAt: string
  updatedAt: string | null
  roles: { id: number; name: string }[]      // name = role.description
  status: { idUserStatus: UserStatusId; description: 'Active' | 'Deactivated' }
  tenantValidationPending: false
  multiTenancyEnabled: false
}
export interface UsersQuery {
  search?: string                              // matches first_name, last_name, email (ILIKE)
  roleIds?: number[]                           // filter: user has ANY of these roles
  statuses?: UserStatusId[]                    // filter
  createdFrom?: string; createdTo?: string     // date range on created_at
  sort?: 'firstName' | 'lastName' | 'email' | 'dateIns' | 'dateMod' | 'status'
  dir?: 'asc' | 'desc'
  page?: number; pageSize?: number
}
```

## 5. Anti-Lockout Guardrails (pure)

`lib/rbac/user-guards.ts` — pure functions, unit-tested, called by the actions after loading the needed facts:

- `assertRoleChangeAllowed({ targetUserId, currentUserId, targetCurrentlyAdmin, newRolesIncludeAdmin, otherAdminCount })`:
  - Throw "Non puoi rimuovere il tuo accesso admin" if `targetUserId === currentUserId && targetCurrentlyAdmin && !newRolesIncludeAdmin`.
  - Throw "Non puoi rimuovere l'ultimo amministratore" if `targetCurrentlyAdmin && !newRolesIncludeAdmin && otherAdminCount === 0`.
- `assertStatusChangeAllowed({ targetUserId, currentUserId, newStatus, targetIsAdmin, otherActiveAdminCount })` (only constrains **deactivation**, `newStatus === 1`):
  - Throw "Non puoi disattivare il tuo account" if `targetUserId === currentUserId`.
  - Throw "Non puoi disattivare l'ultimo amministratore attivo" if `targetIsAdmin && otherActiveAdminCount === 0`.

`otherAdminCount` / `otherActiveAdminCount` = count of users **other than the target** holding `ROLE_ADMINISTRATOR` (and, for status, with `id_user_status=2`). The action computes these via `createAdminClient()`; the current user id comes from the authenticated session.

## 6. Server Actions (`users-actions.ts`)

- `updateUserRoles(userId, roleIds: number[])`: `requireAdmin()`; force-include `ROLE_REGISTERED`; load target's current roles + the other-admin count; `assertRoleChangeAllowed(...)`; then `delete from user_role where user_id=userId` + insert the new set (date_ins now). `router.refresh()` on the caller.
- `setUserStatus(userId, status: UserStatusId)`: `requireAdmin()`; load target's admin flag + other-active-admin count; `assertStatusChangeAllowed(...)`; `update users set id_user_status=status, last_status_ts=now() where id=userId`.
- Both surface errors via thrown `Error` with Italian messages; the UI shows them (no swallow).

## 7. Read Service (`users-service.ts`)

- `listUsers(q: UsersQuery): Promise<UserDTO[]>` — query `public.users` joined to `user_role`→`role`; apply search (ILIKE on first_name/last_name/email), role filter (users having ANY of `roleIds`), status filter, created date-range; sort (`status`→`id_user_status`, `dateIns`→`created_at`, `dateMod`→`updated_at`); paginate. Map rows → `UserDTO` (roles aggregated, status mapped to {id, description}).
- `countUsers(q)` — same filters, returns total for pagination.
- `getAllRoles(): Promise<{ id: number; name: string }[]>` — all roles for the filter + modal (name = `description`), ordered by `id_role`.

## 8. UI

- **`page.tsx`** (Server Component): reads search-params → `UsersQuery`; `Promise.all([listUsers, countUsers, getAllRoles])`; renders `UsersTableClient`.
- **`UsersTableClient`**: reuses `DataTable`. Columns: **User** (`firstName lastName`, fallback email), **Email**, **Ruoli** (comma-joined names; em-dash if none), **Stato** (`StatusBadge`, clickable), **Creato**, **Aggiornato** (relative time). Toolbar: search input (debounced, URL param), Filtri (roles multi-select from `getAllRoles`, statuses multi-select, created date-range). Sort + pagination via URL params (Phase-1 pattern). Row `⋯` → "Gestisci ruoli".
- **`ManageRolesModal`**: checkbox list of all roles, current roles pre-checked; `Registered user` checked+disabled (DEC-P3-7); confirm → `updateUserRoles` → close + refresh; shows action errors inline.
- **`StatusBadge`**: green "Active" / grey "Deactivated"; click → confirm → `setUserStatus(id, toggled)` → refresh; shows errors via alert/inline.

## 9. Error Handling & Security

- Every action calls `requireAdmin()` first; reads use `createAdminClient()` (service_role); RLS stays enabled.
- Guardrails prevent self-lockout and last-admin removal/deactivation (§5), unit-tested independently of the DB.
- No silent error swallow: failed mutations surface a message to the admin.

## 10. Testing

- [ ] **Unit (vitest):** `user-guards` — self-admin-removal blocked; last-admin-removal blocked; allowed when another admin exists; self-deactivation blocked; last-active-admin deactivation blocked; non-deactivation status changes unconstrained.
- [ ] **Unit (vitest):** `listUsers` query mapping — search/role/status/date filters compose; sort field mapping (`status`→`id_user_status`, etc.); role aggregation + status mapping in the DTO. (Pure mapping/filter helpers extracted so they can be tested without a live DB.)
- [ ] **E2E (pytest+Playwright):** list loads with columns + toolbar; search narrows; Gestisci-ruoli modal assigns/removes a non-admin role and persists; status badge toggles Active↔Deactivated and persists; an admin cannot remove their own admin role / cannot deactivate themselves (guardrail surfaces an error); a non-admin is denied `/userManagement`.
- [ ] **Browser verification:** table renders; manage-roles + status toggle work end-to-end.

## 11. Carry-Forwards / Out of Scope

- [ ] ID=CARRY-P3-1, Title=updateUserRoles non-atomic (delete+insert, no transaction) — same CARRY-8 debt as Phase 1; acceptable for now, fold into a shared RPC later.
- [ ] ID=CARRY-P3-2, Title=Leftover E2E test roles/users in the remote DB (ids ≥100 from prior phases) — cleanup pending; not blocking.
- Multitenancy enforcement, user create/delete, and `country/branch/flow/...` profile editing are explicitly out of scope.
