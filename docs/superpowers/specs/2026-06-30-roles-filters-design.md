# Roles & Permissions — Filters (R-03) — Design Spec

**Date:** 2026-06-30
**Branch:** `feature/rbac-fixes`
**Builds on:** `docs/superpowers/specs/2026-06-28-rbac-phase-1-roles-permissions-design.md` (Roles list, `DataTable`, `RolesTableClient`)
**Target:** `sources/microservices/web-construct/`
**Source requirement:** `docs/input-specs/rbac-fixes-and-improvements/rbac-improvements.md` — R-03 "Filtri" (R-03.01, R-03.02)

---

## Summary

The Roles & Permissions list (`/roles-permissions`) already has a "Filtri" drawer with one filter ("Ha permessi"). This adds two more filters to that drawer:

- **R-03.01** — a creation-date range, picked via a calendar widget (start/end), filtering on `dateIns`.
- **R-03.02** — a min/max range on the "Utenti associati" (`associatedUsers`) column.

### Key decisions

- [x] DEC-1 — R-03.02's "Numero di ruoli da min a max" means a min/max range on `associatedUsers` (the only per-role numeric column besides ID/dates), confirmed with the user.
- [x] DEC-2 — The date filter applies to `dateIns` (creation date) only, matching the backend support that already exists (`RolesQuery.startDateIns`/`endDateIns`); `dateMod` is out of scope.
- [x] DEC-3 — Calendar widget uses the `react-day-picker` library (new dependency, React 19-compatible) rather than native `<input type="date">` or a bespoke component, to get a real calendar popover with minimal custom code.
- [x] DEC-4 — All new filters apply automatically, debounced ~350ms, the same pattern as the existing search box — no explicit "Apply" button.

---

## 1. Backend — `lib/rbac/types.ts`, `lib/rbac/roles-service.ts`

- `RolesQuery` gains `minAssociatedUsers?: number` and `maxAssociatedUsers?: number`. (`startDateIns`/`endDateIns` already exist — no change needed for R-03.01.)
- `applyFilters` in `roles-service.ts` gains, alongside the existing `hasPermission`/`startDateIns`/`endDateIns` filters:
  - `if (query.minAssociatedUsers != null) r = r.gte('associated_users', query.minAssociatedUsers)`
  - `if (query.maxAssociatedUsers != null) r = r.lte('associated_users', query.maxAssociatedUsers)`
- `associated_users` is a computed column on `role_list_view` (already used for sorting), so `.gte`/`.lte` work the same as on a physical column.

---

## 2. Frontend — `app/(protected)/roles-permissions/page.tsx`

Reads four new search params the same way `hasPermission` is read today, and passes them through to `listRoles` and down to `RolesTableClient`:
- `minAssociatedUsers`, `maxAssociatedUsers` (parsed as numbers, `undefined` if blank/invalid)
- `startDateIns`, `endDateIns` (passed through as strings)

---

## 3. Frontend — `components/rbac/roles/RolesTableClient.tsx`

`filtersSlot` gains two new filter groups alongside the existing "Ha permessi" checkbox:

- **Utenti associati (Da / A):** two `<input type="number">` fields. `onChange` debounced ~350ms (same `useEffect`-based pattern as the existing search debounce) → `setParam({ minAssociatedUsers, maxAssociatedUsers, page: '0' })`.
- **Data di creazione (Da / A):** two date fields, each rendering a `react-day-picker` `<DayPicker>` in a popover (open on input focus/click, close on selection or outside-click). Selecting a date debounces the same ~350ms before updating `startDateIns`/`endDateIns` via `setParam`.

New dependency: `react-day-picker` (added to `package.json`), styled with Tailwind to match the existing filter-drawer look (border, rounded, gray palette — consistent with the checkbox row already there).

---

## 4. Testing

- [ ] **Type-check / lint** — `tsc --noEmit`, `npm run lint`.
- [ ] **Browser verification** — log in, open `/roles-permissions`, open "Filtri": set Utenti associati min/max → confirm URL params + filtered rows; pick a creation-date range via the calendar popover → confirm URL params + filtered rows; combine both filters with "Ha permessi" and search.
- [ ] **E2E (pytest/Playwright)** — extend `test_roles.py` (or a new test) with a case that sets the associatedUsers range and asserts the row set narrows; a case that sets the date range and asserts the row set narrows.

---

## 5. Out of scope

- Filtering/sorting on `dateMod` (last-updated) — DEC-2.
- An explicit "Apply filters" button — DEC-4.
- Any change to the existing "Ha permessi" filter or to R-02 (sorting), already done.
