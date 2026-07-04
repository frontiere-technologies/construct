# Active Filters Indicator + Quick Clear — Design Spec

**Status:** Approved by user, ready for planning.

## Problem

On the three RBAC list pages (Users, Ruoli & permessi, Functionalities), filters live entirely inside the "Filtri" drawer (per V-02, already implemented). Once applied and the drawer is closed, there is no visual cue on the main page that any filter is active, and clearing them requires reopening the drawer and clicking Reset. Users asked for two things directly on the main pages, without opening the drawer:

1. See at a glance whether filters are set.
2. Remove all active filters in one action.

## Scope

Applies to all three pages: Users (`user-management`), Ruoli & permessi (`roles-permissions`), Functionalities (`functionalities`).

## Design

### Indicator: numeric badge on the "Filtri" button

The "Filtri" button shows a small numeric badge with the count of currently **applied** filters (i.e. the filters actually in effect — URL params for Users/Roles, applied local state for Functionalities — not unconfirmed edits sitting in an open drawer). The badge is not rendered at all when the count is 0 — the button then looks exactly as it does today.

**Counting rule per page** (a field counts as 1 active filter only when it has a non-empty applied value):

| Page | Fields counted | Special rule | Max |
|---|---|---|---|
| Users | Ruolo, Stato, Cerca, Data di creazione | Data di creazione counts as **1** if either Da or A (or both) is set | 4 |
| Ruoli & permessi | Ha permessi, Cerca, Data di creazione | Data di creazione counts as **1** if either Da or A (or both) is set | 3 |
| Functionalities | Cerca | — | 1 |

### Quick clear: "Rimuovi filtri" button

When the active-filter count is > 0, a text button labeled "Rimuovi filtri" appears in the same toolbar row as "Filtri" (next to it). Clicking it clears every applied filter immediately (no confirmation dialog, matching the drawer's existing Reset behavior) and re-renders the unfiltered list. When count is 0, the button is not rendered.

## Architecture

- **`components/rbac/DataTable.tsx`** (shared by Users and Roles) gains two new optional props:
  - `activeFilterCount?: number`
  - `onClearFilters?: () => void`

  The Filtri button renders the numeric badge inline when `activeFilterCount` is truthy and > 0. The "Rimuovi filtri" button renders in the same toolbar group, immediately after Filtri, only when `activeFilterCount > 0`, calling `onClearFilters` on click.

- **`components/rbac/users/UsersTableClient.tsx`** and **`components/rbac/roles/RolesTableClient.tsx`** each compute `activeFilterCount` from their own **applied `props`** (not draft state) using the counting rule above, and pass `onClearFilters={resetFilters}` — reusing the `resetFilters` function that already exists in both files (used today by the drawer's Reset button). No new clearing logic is introduced; the main-page button is a second entry point to the same function.

- **`components/rbac/functionalities/FunctionalitiesTreeClient.tsx`** (no `DataTable`) renders the same badge + button pattern directly in its existing toolbar row (the one already holding Filtri + Crea nuovo, added in the F-01/V-02 work). Count is `search.trim() !== '' ? 1 : 0` (the applied `search` state, not `searchDraft`). Clicking "Rimuovi filtri" runs the same clear logic already used by the drawer's `onReset` (`setSearchDraft(''); setSearch('')`).

## Testing

New/extended e2e coverage (Python/Playwright, `sources/tests/e2e/`) per page:
- Badge is absent (or shows nothing meaningful) with no filters applied.
- After applying one filter via the drawer, the badge shows the correct count and "Rimuovi filtri" is visible.
- Clicking "Rimuovi filtri" restores the baseline (unfiltered) list, and both the badge and the button disappear.
- (Users/Roles only) Applying two independent filters (e.g. Ruolo + Stato, or Ha permessi + Cerca) shows count 2, confirming the counting rule isn't hardcoded to "any filter = 1".

Use `data-testid="filters-badge"` and `data-testid="clear-filters"` uniformly across all three pages' markup, so tests can target them without page-specific selectors.

## Out of Scope

- Per-field removable chips (a richer alternative considered and explicitly declined in favor of the simpler badge + bulk-clear approach).
- Any change to the drawer's own Reset/Applica behavior — this is purely an additional, page-level shortcut to the same underlying clear action.
