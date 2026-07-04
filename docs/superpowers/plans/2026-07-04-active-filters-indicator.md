# Active Filters Indicator + Quick Clear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Users, Ruoli & permessi, and Functionalities, show a numeric badge on the "Filtri" button counting currently applied filters, and a "Rimuovi filtri" button next to it (visible only when the count is > 0) that clears every applied filter in one click without opening the drawer.

**Architecture:** `components/rbac/DataTable.tsx` (shared by Users and Roles) gains two optional props — `activeFilterCount` and `onClearFilters` — used to render the badge inside the existing "Filtri" button and a new "Rimuovi filtri" text button beside it. `UsersTableClient.tsx` and `RolesTableClient.tsx` compute the count from their own applied `props` (not drawer draft state) and pass their existing `resetFilters` function as `onClearFilters` — no new clearing logic, just a second entry point to the function the drawer's Reset button already calls. `FunctionalitiesTreeClient.tsx` has no `DataTable`, so it replicates the same badge + button markup directly in its own toolbar row, based on its own applied `search` state.

**Tech Stack:** React 19 + Next.js 15 (App Router), TypeScript, Tailwind CSS v4, lucide-react icons. Tests: Python + Playwright via `uv run pytest` against the already-running dev server on `http://localhost:3000` (`sources/tests/e2e/`).

## Global Constraints

- Never invoke `python`/`pip` directly — always `uv run pytest ...` from the repo root (per repo `CLAUDE.md`).
- The badge/count reflects **applied** filters (URL params for Users/Roles, applied local state for Functionalities) — never the unconfirmed draft state of an open-but-not-yet-applied drawer.
- Counting rule: each of Ruolo, Stato, Cerca (Users); Ha permessi, Cerca (Roles); Cerca (Functionalities) counts as 1 if non-empty. "Data di creazione" (Da/A pair, Users and Roles) counts as 1 if either Da or A (or both) is set — never 2.
- `data-testid="filters-badge"` on the badge element, `data-testid="clear-filters"` on the clear button — identical across all three pages, so tests can target them uniformly.
- No confirmation dialog on clicking "Rimuovi filtri" — same behavior as the drawer's existing Reset button.
- Badge/button use `bg-primary text-white` (the project's existing `--color-primary` Tailwind token, already used elsewhere) for the badge fill — no new color introduced.

---

### Task 1: DataTable badge + clear button, wired into Users

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/DataTable.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`
- Test: `sources/tests/e2e/test_users.py`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `DataTable<T>` accepts two new optional props — `activeFilterCount?: number` and `onClearFilters?: () => void` — that Task 2 (Roles) will also pass. The badge/button markup and `data-testid`s established here (`filters-badge`, `clear-filters`) are the pattern Task 3 (Functionalities) replicates without a `DataTable`.

- [✅] **Step 1: Write the failing e2e test**

Add to `sources/tests/e2e/test_users.py` (after `test_filter_by_role`):

```python
def test_filters_badge_and_clear(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    # No filters applied: no badge, no clear button
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)

    # Apply two filters: Ruolo + Stato
    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-role").click()
    page.get_by_test_id("filter-role-option-1").click()  # 1 = Administrator
    page.get_by_test_id("filter-status").click()
    page.get_by_test_id("filter-status-option-1").click()  # 1 = Disattivato
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("roleIds=1"))
    expect(page).to_have_url(re.compile("statuses=1"))

    # Badge shows 2, clear button visible
    expect(page.locator('[data-testid="filters-badge"]')).to_have_text("2")
    expect(page.locator('[data-testid="clear-filters"]')).to_be_visible()

    # Clicking it clears everything in one shot
    page.get_by_test_id("clear-filters").click()
    expect(page).not_to_have_url(re.compile("roleIds="))
    expect(page).not_to_have_url(re.compile("statuses="))
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)
```

- [✅] **Step 2: Run the test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_users.py::test_filters_badge_and_clear -v`
Expected: FAIL — `page.locator('[data-testid="filters-badge"]')` and `[data-testid="clear-filters"]` don't exist yet anywhere in the DOM, so the "no badge" assertions pass vacuously but the later `to_have_text("2")` assertion times out because no element matches.

- [✅] **Step 3: Add the props, badge, and clear button to `DataTable.tsx`**

1. Add two new optional props to the interface (after `onResetFilters?: () => void`, before `actionButton?: React.ReactNode`):

```tsx
  onResetFilters?: () => void
  activeFilterCount?: number
  onClearFilters?: () => void
  actionButton?: React.ReactNode
```

2. Add them to the destructure:

```tsx
  const { columns, rows, rowKey, sort, onSortChange, page, totalPages, onPageChange,
    filtersSlot, onOpenFilters, onApplyFilters, onResetFilters, activeFilterCount, onClearFilters, actionButton, rowMenu, onRowClick } = props
```

3. Replace the Filtri button + `{actionButton}` block with (badge inside the Filtri button, new "Rimuovi filtri" button between Filtri and the action button):

```tsx
          {filtersSlot && (
            <button onClick={() => {
              if (!showFilters) onOpenFilters?.()
              setShowFilters(s => !s)
            }} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">
              <SlidersHorizontal size={16} /> Filtri
              {!!activeFilterCount && (
                <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          {!!activeFilterCount && (
            <button data-testid="clear-filters" onClick={onClearFilters} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline-offset-2 hover:underline">
              Rimuovi filtri
            </button>
          )}
          {actionButton}
```

- [✅] **Step 4: Compute the count and wire `onClearFilters` in `UsersTableClient.tsx`**

1. Add the count calculation right after the `columns` array definition (after the closing `]` of `columns`, before `const filters = (`):

```tsx
  const activeFilterCount =
    (props.roleId != null ? 1 : 0) +
    (props.statusId != null ? 1 : 0) +
    (props.search ? 1 : 0) +
    (props.createdFrom || props.createdTo ? 1 : 0)
```

2. Pass the new props to `<DataTable>` (add right after `onResetFilters={resetFilters}`):

```tsx
        onResetFilters={resetFilters}
        activeFilterCount={activeFilterCount}
        onClearFilters={resetFilters}
```

- [✅] **Step 5: Run the test to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_users.py -v`
Expected: all tests PASS, including `test_filters_badge_and_clear` and the pre-existing `test_filter_by_status_and_reset`/`test_filter_by_role` (unaffected — they don't touch the badge/clear button).

- [✅] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/DataTable.tsx sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx sources/tests/e2e/test_users.py
git commit -m "feat(rbac): show active-filters badge + quick clear on Users"
```

---

### Task 2: Wire the badge + clear button into Roles

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`
- Test: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Consumes: `DataTable<T>`'s `activeFilterCount`/`onClearFilters` props from Task 1 (already merged, unchanged here).
- Produces: nothing consumed by later tasks (Task 3 is independent).

- [✅] **Step 1: Write the failing e2e test**

Add to `sources/tests/e2e/test_roles.py` (after `test_filter_by_has_permission_and_reset`):

```python
def test_filters_badge_and_clear(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-has-permission").click()
    page.get_by_test_id("filter-has-permission-option-false").click()
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("hasPermission=false"))

    expect(page.locator('[data-testid="filters-badge"]')).to_have_text("1")
    expect(page.locator('[data-testid="clear-filters"]')).to_be_visible()

    page.get_by_test_id("clear-filters").click()
    expect(page).not_to_have_url(re.compile("hasPermission="))
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)
```

- [✅] **Step 2: Run the test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_roles.py::test_filters_badge_and_clear -v`
Expected: FAIL — no `data-testid="filters-badge"`/`"clear-filters"` element exists on this page yet (Task 1 only wired Users).

- [✅] **Step 3: Compute the count and wire `onClearFilters` in `RolesTableClient.tsx`**

1. Add the count calculation right after the `columns` array definition (after its closing `]`, before `const filters = (`):

```tsx
  const activeFilterCount =
    (props.hasPermission != null ? 1 : 0) +
    (props.search ? 1 : 0) +
    (props.startDateIns || props.endDateIns ? 1 : 0)
```

2. Pass the new props to `<DataTable>` (add right after `onResetFilters={resetFilters}`):

```tsx
        onResetFilters={resetFilters}
        activeFilterCount={activeFilterCount}
        onClearFilters={resetFilters}
```

- [✅] **Step 4: Run the test to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: all tests PASS, including `test_filters_badge_and_clear` and every pre-existing test in the file.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx sources/tests/e2e/test_roles.py
git commit -m "feat(rbac): show active-filters badge + quick clear on Roles"
```

---

### Task 3: Add the badge + clear button to Functionalities' own toolbar

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx`
- Test: `sources/tests/e2e/test_functionalities.py`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (Functionalities has no `DataTable`) — replicates the same `data-testid`s and visual pattern independently.
- Produces: nothing consumed elsewhere.

- [✅] **Step 1: Write the failing e2e test**

Add to `sources/tests/e2e/test_functionalities.py` (after `test_filter_drawer_search`):

```python
def test_filters_badge_and_clear(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)

    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill("Admin")
    page.get_by_role("button", name="Applica").click()
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()

    expect(page.locator('[data-testid="filters-badge"]')).to_have_text("1")
    expect(page.locator('[data-testid="clear-filters"]')).to_be_visible()

    page.get_by_test_id("clear-filters").click()
    expect(page.get_by_text("Home", exact=True).first).to_be_visible()
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)
```

- [✅] **Step 2: Run the test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_filters_badge_and_clear -v`
Expected: FAIL — no `data-testid="filters-badge"`/`"clear-filters"` element exists yet on this page.

- [✅] **Step 3: Add the badge + clear button to the toolbar row**

Replace the toolbar `<div>` block:

```tsx
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={() => {
            if (!showFilters) setSearchDraft(search)
            setShowFilters(s => !s)
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <SlidersHorizontal size={16} /> Filtri
        </button>
        <button onClick={() => router.push(`/functionalities/create?root=${tab}`)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
```

with:

```tsx
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={() => {
            if (!showFilters) setSearchDraft(search)
            setShowFilters(s => !s)
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <SlidersHorizontal size={16} /> Filtri
          {search.trim() !== '' && (
            <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
              1
            </span>
          )}
        </button>
        {search.trim() !== '' && (
          <button data-testid="clear-filters" onClick={() => { setSearchDraft(''); setSearch('') }} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline-offset-2 hover:underline">
            Rimuovi filtri
          </button>
        )}
        <button onClick={() => router.push(`/functionalities/create?root=${tab}`)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
```

Note this reads and writes the same `search`/`setSearchDraft`/`setSearch` state already defined earlier in the component (`useState` calls near the top) — no new state is introduced.

- [✅] **Step 4: Run the test to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: all tests PASS, including the two pre-existing F-01/V-02 tests (`test_create_button_aligned_with_filtri`, `test_filter_drawer_search`) and the new `test_filters_badge_and_clear`.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx sources/tests/e2e/test_functionalities.py
git commit -m "feat(rbac): show active-filters badge + quick clear on Functionalities"
```

---

### Task 4: Full regression pass and lint

**Files:**
- None modified — verification only.

**Interfaces:**
- Consumes: nothing new — verifies Tasks 1-3 together.

- [✅] **Step 1: Run ESLint**

Run: `cd sources/microservices/web-construct && npm run lint`
Expected: no new errors (no unused-import or unused-var errors introduced by the badge/clear-button markup).

- [✅] **Step 2: Run the full RBAC e2e suite**

Run: `uv run pytest sources/tests/e2e/test_users.py sources/tests/e2e/test_roles.py sources/tests/e2e/test_functionalities.py -v`
Expected: all tests PASS (23 total: 7 in test_users.py, 7 in test_roles.py, 9 in test_functionalities.py, after the 3 new tests added across Tasks 1-3).

- [✅] **Step 3: Manual browser check**

Take screenshots of `/user-management`, `/roles-permissions`, and `/functionalities` with a filter applied on each, confirming: the "Filtri" button shows the numeric badge, "Rimuovi filtri" appears next to it, and clicking it restores the unfiltered list and hides both the badge and the button.
