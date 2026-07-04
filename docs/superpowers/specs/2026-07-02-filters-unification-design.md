# Filters UI — Unification & Redesign (V-01) — Design Spec

**Date:** 2026-07-02
**Branch:** `feature/rbac-fixes`
**Target:** `sources/microservices/web-construct/`
**Source requirement:** `docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md` — V-01 "Cambiare e uniformare la pagina sui filtri"
**Reference mockups:** `docs/input-specs/rbac-additional-fixes/images/roles-filters.png`, `users-filters.png` (legacy `aplatform-test.arcese.com` app)

---

## Summary

Today the Roles page (`/roles-permissions`) has a filter panel (inline, collapsible, auto-applies on change with a 350ms debounce, no Apply/Reset buttons), while the Users page (`/user-management`) has **no filter UI at all** even though its backend (`UsersQuery`) already supports `roleIds`, `statuses`, `createdFrom`/`createdTo`.

The reference screenshots show a different, more complete pattern: a slide-over drawer titled "Filtri" with dropdown/date fields and explicit **Reset / Applica** buttons. This spec redesigns the filter UI on both pages to that unified drawer pattern, and fills in the missing Users filters.

### Key decisions (confirmed with user)

- [x] DEC-1 — Target pattern is the reference slide-over drawer with explicit Reset/Applica buttons, replacing the current inline auto-apply panel on Roles.
- [x] DEC-2 — Button labels are unified as **"Reset" / "Applica"** on both pages (the two reference screenshots disagreed with each other — Roles said "Reset filtri"/"Applica", Users said "Reset"/"Cerca" — we pick one consistent pair).
- [x] DEC-3 — The Roles "Utenti associati" min/max filter (added in R-03.02, not present in the legacy reference) is **dropped**, including its backend support, to match the unified target exactly.
- [x] DEC-4 — "Data di creazione" keeps the existing two-field **Da/A** `DateRangeFilter` component (already built, tested, and working), restyled to fit the new drawer row. We do not build a new single-field range picker just to match the screenshot's single box, since the screenshot is ambiguous about whether that box already opens a two-ended range underneath.
- [x] DEC-5 — The new "Ruolo" filter on Users is **single-select** (one role at a time), reusing the existing `CustomSelect` dropdown component as-is, rather than building a new multi-select component. `UsersQuery.roleIds` still accepts an array, we just always pass a one-element array (or `undefined`).

---

## 1. New shared component — `components/rbac/FilterDrawer.tsx`

A slide-over panel replacing `DataTable`'s current inline `filtersSlot` rendering:

- Fixed-position overlay: backdrop (click closes without applying) + panel sliding in from the right, full height.
- Header: "Filtri" title + close (X) button. No back-arrow (single level of navigation, unlike the legacy multi-step drawer).
- Body: scrollable, renders `filtersSlot` content — one full-width field row per filter (label + control), stacked vertically. This generalizes cleanly regardless of how many fields a given page has (Roles: 2 rows, Users: 3 rows).
- Footer: "Reset" and "Applica" buttons.
  - **Applica** — calls `onApplyFilters()`, then closes the drawer. The table client is responsible for committing its draft field state to the URL inside this callback.
  - **Reset** — calls `onResetFilters()` immediately (clears draft state *and* URL filter params in one step) and keeps the drawer open so the user sees the cleared fields.

## 2. `components/rbac/DataTable.tsx`

- Replace the current `showFilters && filtersSlot && <div className="p-4 ...">` inline block with `<FilterDrawer open={showFilters} onClose={...} onApplyFilters={onApplyFilters} onResetFilters={onResetFilters}>{filtersSlot}</FilterDrawer>`.
- New optional props: `onApplyFilters?: () => void`, `onResetFilters?: () => void`.
- "Filtri" toggle button behavior unchanged (still only rendered `{filtersSlot && ...}`).

## 3. Shared select — move `CustomSelect.tsx`

Move `components/rbac/functionalities/CustomSelect.tsx` → `components/rbac/CustomSelect.tsx` (it's generic, not Functionalities-specific) and update its one existing import in the Functionalities feature. Used by:
- Roles: "Ha permessi" (`Tutti` / `Sì` / `No`).
- Users: "Ruolo" (`Tutti` + one option per role) and "Stato" (`Tutti` / `Attivo` / `Disattivato`).

## 4. `components/rbac/roles/RolesTableClient.tsx`

- "Ha permessi" checkbox → `CustomSelect` with options `Tutti` (default/unset) / `Sì` / `No`, mapped to `hasPermission: true | false | undefined`.
  - Backend currently only supports filtering for `true` (`roles-service.ts:33` — `if (query.hasPermission) r = r.eq('has_permissions', true)`, a truthy check that can't distinguish `false` from `undefined`). This needs to change to `if (query.hasPermission != null) r = r.eq('has_permissions', query.hasPermission)` so "No" is filterable too.
  - `app/(protected)/roles-permissions/page.tsx:19` parsing (`sp.hasPermission === 'true' || undefined`) becomes a three-way parse: `'true'` → `true`, `'false'` → `false`, anything else → `undefined`.
- Remove the "Utenti associati" min/max number inputs and their local state (`minUsers`/`maxUsers`).
- Keep `DateRangeFilter` for "Data di creazione", restyled as a full-width row.
- All three fields become **draft state** (local `useState`, initialized from props/URL) instead of auto-committing via the existing 350ms debounce effect. The debounce `useEffect` that pushes filter changes to the URL is removed; committing now happens only in the `onApplyFilters` handler passed to `DataTable`.
- The free-text search box is untouched (stays debounced, outside the drawer).

## 5. Backend cleanup — drop "Utenti associati" filter (DEC-3)

- `lib/rbac/types.ts` — remove `minAssociatedUsers?`/`maxAssociatedUsers?` from `RolesQuery`.
- `lib/rbac/roles-service.ts` — remove the corresponding `.gte('associated_users', ...)`/`.lte('associated_users', ...)` branches in `applyFilters`.
- `app/(protected)/roles-permissions/page.tsx` — remove parsing of `minAssociatedUsers`/`maxAssociatedUsers` search params.
- The `associatedUsers` **column** (display + sort) is untouched — only the min/max *filter* goes away.

## 6. `components/rbac/users/UsersTableClient.tsx` — new filters

New `filtersSlot` (Users currently passes none to `DataTable`):
- **Ruolo** — `CustomSelect` over `allRoles` (already passed into this component), single-select, `Tutti` default → `roleIds: [id] | undefined`.
- **Stato** — `CustomSelect`, options `Tutti` / `Attivo` (`USER_STATUS_ACTIVE`) / `Disattivato` (`USER_STATUS_DEACTIVATED`) → `statuses: [id] | undefined`.
- **Data di creazione** — `DateRangeFilter` (reused as-is) → `createdFrom`/`createdTo`.
- Same draft-state + Applica/Reset pattern as Roles (§4).

## 7. `app/(protected)/user-management/page.tsx`

- Parse `sp.createdFrom`/`sp.createdTo` into `UsersQuery.createdFrom`/`createdTo` (backend already supports these — see `users-service.ts:32-33`).
- `roleIds`/`statuses` parsing already exists (`page.tsx:14-15`), no change needed there.

## 8. Testing

- Update `sources/tests/e2e/test_roles.py`: remove cases exercising `filter-min-associated-users`/`filter-max-associated-users`; add/adjust cases for the "Ha permessi" `CustomSelect` and the new Reset/Applica drawer flow (filters no longer auto-apply — tests must click "Applica").
- Add e2e coverage for the new Users filters (Ruolo, Stato, Data di creazione) and Reset/Applica behavior.
- `DateRangeFilter.test.tsx` — no logic changes expected, verify it still passes after restyling.
- `tsc --noEmit` and `npm run lint`.
- Manual browser verification: open both drawers, confirm field rows, Applica commits + closes + filters the table, Reset clears + updates table immediately, backdrop/X closes without applying pending (unapplied) changes.

## 9. Out of scope

- Multi-select for "Ruolo" (DEC-5).
- A single-field date-range box replacing Da/A (DEC-4).
- Any change to the free-text search box (stays debounced, outside the drawer, on both pages).
- Any change to Functionalities filters (not mentioned in V-01).
