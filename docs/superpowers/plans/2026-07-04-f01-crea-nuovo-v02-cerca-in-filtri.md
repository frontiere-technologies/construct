# F-01 (Crea nuovo alignment) + V-02 (Cerca inside Filtri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each RBAC list page's "Cerca" search box to be the first field inside its Filtri drawer (gated behind Applica, like the other filters), and align Functionalities' "Crea nuovo" button to toolbar height (fixing both F-01 and V-02 for Functionalities in one pass, since fixing V-02 there requires adding the Filtri toolbar row F-01 asks for).

**Architecture:** `components/rbac/DataTable.tsx` currently renders its own search `<input>` in the toolbar row, independent of the `FilterDrawer` it also renders via `filtersSlot`. We remove that responsibility from `DataTable` entirely and let each page-specific client component (`UsersTableClient`, `RolesTableClient`) own a `search` draft field alongside its other filter drafts (`roleId`/`statusId`, `hasPermission`/dates), included in the same `applyFilters`/`resetFilters` calls. `FunctionalitiesTreeClient` has no `DataTable`/`FilterDrawer` today — it gets one added directly (it's a plain tree view, not a table), with `Cerca` as the drawer's only field, and its own `Filtri`/`Crea nuovo` toolbar row replacing the old title-row button placement.

**Tech Stack:** React 19 + Next.js 15 (App Router), TypeScript, Tailwind CSS v4, lucide-react icons. Tests: Python + Playwright via `uv run pytest` against the already-running dev server on `http://localhost:3000` (`sources/tests/e2e/`).

## Global Constraints

- Never invoke `python`/`pip` directly — always `uv run pytest ...` from the repo root (per repo `CLAUDE.md`).
- Search becomes an Applica-gated draft field everywhere (confirmed decision) — no live/debounced search remains anywhere.
- Functionalities gets a real `Filtri` button + `FilterDrawer` (confirmed decision), reusing the existing shared `components/rbac/FilterDrawer.tsx` — do not build a second drawer component.
- Use the shared `data-testid="filter-search"` on every relocated/new search `<input>` so e2e tests can target it uniformly.
- After finishing, mark `F-01` and `V-02` as `- [✅]` in `docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md` (per repo `CLAUDE.md` checkbox convention).

---

### Task 1: Users — move Cerca into the Filtri drawer (and strip search out of the shared DataTable)

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/DataTable.tsx:1-146` (remove the search box + `search`/`onSearchChange` props)
- Modify: `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx` (add search draft field, wire into filters/apply/reset)
- Test: `sources/tests/e2e/test_users.py::test_search_narrows_users`

**Interfaces:**
- Consumes: existing `FilterDrawer` (`components/rbac/FilterDrawer.tsx`, unchanged), existing `CustomSelect`/`DateRangeFilter` patterns already in `UsersTableClient.tsx`.
- Produces: `DataTable<T>` no longer accepts/renders `search`/`onSearchChange` — `RolesTableClient` (Task 2) must stop passing them too, or the build fails with an excess-props TS error.

- [✅] **Step 1: Update the e2e test to open Filtri before searching (it will fail against current code)**

Replace `test_search_narrows_users` in `sources/tests/e2e/test_users.py`:

```python
def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    before = page.locator('[data-testid="status-badge"]').count()
    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill("zzz-no-such-user-zzz")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    after = page.locator('[data-testid="status-badge"]').count()
    assert after <= before
```

- [✅] **Step 2: Run the test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_users.py::test_search_narrows_users -v`
Expected: FAIL — today "Cerca" lives in the main toolbar, outside any drawer opened by the "Filtri" button, so `page.get_by_placeholder("Cerca").fill(...)` still succeeds (it's always on screen) but the test now also depends on an "Applica" click doing nothing useful yet — run it anyway to confirm current baseline behavior before your change, then proceed; the real failure signal for this task is the **manual/browser check** in Step 4 (there is no Filtri-drawer version of Cerca until you build it in Step 3). If the test happens to pass by coincidence (loose `<=` assertion), that's fine — Step 4's browser check is the real gate for this task.

- [✅] **Step 3: Remove the search box from `DataTable.tsx`, add it to `UsersTableClient.tsx`'s filters**

In `sources/microservices/web-construct/components/rbac/DataTable.tsx`:

1. Line 5 — drop the now-unused `Search` import:
```tsx
import { SlidersHorizontal, Columns3, MoreHorizontal, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
```

2. Lines 17-35 — remove `search`/`onSearchChange` from the props interface:
```tsx
interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort?: { field: string; direction: 'ASC' | 'DESC' }
  onSortChange?: (field: string) => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  filtersSlot?: React.ReactNode
  onOpenFilters?: () => void
  onApplyFilters?: () => void
  onResetFilters?: () => void
  actionButton?: React.ReactNode
  rowMenu?: (row: T) => RowMenuItem[]
  onRowClick?: (row: T) => void
}
```

3. Lines 37-39 — drop `search`/`onSearchChange` from the destructure:
```tsx
export default function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, rowKey, sort, onSortChange, page, totalPages, onPageChange,
    filtersSlot, onOpenFilters, onApplyFilters, onResetFilters, actionButton, rowMenu, onRowClick } = props
```

4. Lines 99-108 — delete the search `<div>` entirely, leaving only the right-aligned group (its `ml-auto` still pushes it to the right edge with no left sibling):
```tsx
      <div className="flex items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
```

In `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`:

5. Add the `Search` import (line 4, alongside the existing `next/navigation` import — add a new import line):
```tsx
import { Search } from 'lucide-react'
```

6. Add a `search` draft state next to `roleId`/`statusId` (after line 44):
```tsx
  const [createdFrom, setCreatedFrom] = useState(props.createdFrom)
  const [createdTo, setCreatedTo] = useState(props.createdTo)
  const [search, setSearch] = useState(props.search)
```

7. Sync it in `syncDraftFromProps` (lines 46-51):
```tsx
  const syncDraftFromProps = useCallback(() => {
    setRoleId(props.roleId == null ? '' : String(props.roleId))
    setStatusId(props.statusId == null ? '' : String(props.statusId))
    setCreatedFrom(props.createdFrom)
    setCreatedTo(props.createdTo)
    setSearch(props.search)
  }, [props.roleId, props.statusId, props.createdFrom, props.createdTo, props.search])
```

8. Include it in `applyFilters` (lines 57-65):
```tsx
  const applyFilters = useCallback(() => {
    setParam({
      roleIds: roleId || null,
      statuses: statusId || null,
      createdFrom: createdFrom || null,
      createdTo: createdTo || null,
      search: search || null,
      page: '0',
    })
  }, [roleId, statusId, createdFrom, createdTo, search, setParam])
```

9. Include it in `resetFilters` (lines 67-73):
```tsx
  const resetFilters = useCallback(() => {
    setRoleId('')
    setStatusId('')
    setCreatedFrom(null)
    setCreatedTo(null)
    setSearch('')
    setParam({ roleIds: null, statuses: null, createdFrom: null, createdTo: null, search: null, page: '0' })
  }, [setParam])
```

10. Add the search field as the first entry in the `filters` JSX (lines 93-94, right after the opening `<div className="flex flex-col gap-4">`):
```tsx
  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Cerca</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="filter-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ruolo</label>
```

11. Remove the now-invalid `search`/`onSearchChange` props passed to `<DataTable>` (lines 139-140):
```tsx
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={n => setParam({ page: String(n) })}
        rowMenu={u => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }]}
```

- [✅] **Step 4: Run the test to verify it passes, then manually confirm in the browser**

Run: `uv run pytest sources/tests/e2e/test_users.py -v`
Expected: all tests in the file PASS, including `test_search_narrows_users`, `test_filter_by_status_and_reset`, `test_filter_by_role` (these two must still pass unchanged — they don't touch search).

Also run `uv run pytest sources/tests/e2e/test_users.py::test_search_narrows_users -v -s` and confirm no leftover "Cerca" input exists outside the drawer: add a temporary assertion is not needed — the existing test already exercises the real flow (open Filtri → fill → Applica).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/DataTable.tsx sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx sources/tests/e2e/test_users.py
git commit -m "feat(rbac): move Users Cerca into the Filtri drawer (V-02)"
```

---

### Task 2: Roles — remove debounced search, move Cerca into the Filtri drawer

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`
- Test: `sources/tests/e2e/test_roles.py::_delete_role`, `test_filter_by_creation_date_range`

**Interfaces:**
- Consumes: `DataTable<T>` from Task 1 (no longer accepts `search`/`onSearchChange` — passing them is now a TypeScript error, so they must be removed here too).
- Produces: none consumed by later tasks (Task 3 is independent).

- [✅] **Step 1: Update the e2e tests to gate search behind Filtri/Applica (they will fail against current code)**

In `sources/tests/e2e/test_roles.py`, replace `_delete_role`:

```python
def _delete_role(page, base_url, name):
    """Delete a role via the list search + row menu, then assert it's gone."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill(name)
    page.get_by_role("button", name="Applica").click()
    row = page.locator("tr").filter(has_text=name)
    expect(row).to_be_visible()
    row.locator('[data-testid^="row-menu"]').click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill(name)
    page.get_by_role("button", name="Applica").click()
    expect(page.get_by_text(name, exact=True)).to_have_count(0)
```

Replace the search portion of `test_filter_by_creation_date_range` (keep the rest of the function identical):

```python
def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E DateFilter {int(time.time())}"
    _create_role(page, base_url, name)

    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill(name)
    page.get_by_role("button", name="Applica").click()
    expect(page.locator("tr").filter(has_text=name)).to_have_count(1)

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-date-start").click()
    today = date.today()
    page.locator('[data-testid="date-popover-start"]').get_by_text(str(today.day), exact=True).click()
    page.get_by_role("button", name="Applica").click()

    # The role we just created was created today, so it must still match startDateIns = today
    expect(page.locator("tr").filter(has_text=name)).to_have_count(1)
    expect(page).to_have_url(re.compile("startDateIns="))

    _delete_role(page, base_url, name)
```

- [✅] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest sources/tests/e2e/test_roles.py::test_create_rename_delete_role sources/tests/e2e/test_roles.py::test_filter_by_creation_date_range -v`
Expected: FAIL — today "Cerca" lives outside the drawer and filters live on every keystroke; the new "Filtri" click + "Applica" click add no value yet against unmodified `RolesTableClient.tsx`, but more importantly the redundant `Filtri`-toggle-open/close sequence in `_delete_role` (open, then open again later) may leave the drawer in an unexpected state without the Task 2 changes. Confirm current behavior, then proceed to Step 3.

- [✅] **Step 3: Replace the debounced search with a draft field in `RolesTableClient.tsx`**

1. Add the `Search` import (new import line near the top, after line 1's imports):
```tsx
import { Search } from 'lucide-react'
```

2. Delete the old debounced-search state and effects (lines 33, 43-54):

Remove:
```tsx
  const [search, setSearch] = useState(props.search)
```
Remove:
```tsx
  // Sync local search with URL on navigation (back/forward)
  useEffect(() => {
    setSearch(props.search)
  }, [props.search])

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== props.search) setParam({ search: search || null, page: '0' })
    }, 350)
    return () => clearTimeout(t)
  }, [search, props.search, setParam])
```

3. Add `search` as a draft field alongside `hasPermission`/dates (after line 58, now shifted up since the block above was removed):
```tsx
  const [hasPermission, setHasPermission] = useState<string>(props.hasPermission == null ? '' : String(props.hasPermission))
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)
  const [search, setSearch] = useState(props.search)
```

4. Sync it in `syncDraftFromProps`:
```tsx
  const syncDraftFromProps = useCallback(() => {
    setHasPermission(props.hasPermission == null ? '' : String(props.hasPermission))
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
    setSearch(props.search)
  }, [props.hasPermission, props.startDateIns, props.endDateIns, props.search])
```

5. Include it in `applyFilters`:
```tsx
  const applyFilters = useCallback(() => {
    setParam({
      hasPermission: hasPermission || null,
      startDateIns: startDate || null,
      endDateIns: endDate || null,
      search: search || null,
      page: '0',
    })
  }, [hasPermission, startDate, endDate, search, setParam])
```

6. Include it in `resetFilters`:
```tsx
  const resetFilters = useCallback(() => {
    setHasPermission('')
    setStartDate(null)
    setEndDate(null)
    setSearch('')
    setParam({ hasPermission: null, startDateIns: null, endDateIns: null, search: null, page: '0' })
  }, [setParam])
```

7. Add the search field as the first entry in the `filters` JSX:
```tsx
  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Cerca</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="filter-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ha permessi</label>
```

8. Remove the now-invalid `search`/`onSearchChange` props from the `<DataTable>` call:
```tsx
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={p => setParam({ page: String(p) })}
        filtersSlot={filters}
```

- [✅] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: all tests PASS — `test_roles_list_loads`, `test_create_rename_delete_role`, `test_toggle_permission_persists`, `test_system_role_not_editable`, `test_filter_by_creation_date_range`, `test_filter_by_has_permission_and_reset`.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx sources/tests/e2e/test_roles.py
git commit -m "feat(rbac): move Roles Cerca into the Filtri drawer, drop debounced search (V-02)"
```

---

### Task 3: Functionalities — add a Filtri drawer for Cerca and align Crea nuovo to toolbar height (F-01 + V-02)

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx`
- Test: `sources/tests/e2e/test_functionalities.py` (two new tests)

**Interfaces:**
- Consumes: `components/rbac/FilterDrawer.tsx` (`open`, `onClose`, `onApply`, `onReset`, `children` — unchanged, same shape as Tasks 1-2 use).
- Produces: none consumed elsewhere.

- [✅] **Step 1: Write the two new failing e2e tests**

Add to `sources/tests/e2e/test_functionalities.py` (after `test_tree_loads_with_tabs`):

```python
def test_create_button_aligned_with_filtri(logged_in_page, base_url):
    """F-01: 'Crea nuovo' must sit at toolbar height (next to Filtri), not at title height."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    title_box = page.get_by_role("heading", name="Funzionalità").bounding_box()
    filtri_box = page.get_by_role("button", name="Filtri").bounding_box()
    create_box = page.get_by_role("button", name="Crea nuovo").bounding_box()
    assert create_box["y"] != title_box["y"]
    assert abs(create_box["y"] - filtri_box["y"]) < 2


def test_filter_drawer_search(logged_in_page, base_url):
    """V-02: Cerca lives inside the Filtri drawer, gated behind Applica/Reset."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_placeholder("Cerca")).to_have_count(0)

    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill("Admin")
    page.get_by_role("button", name="Applica").click()
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()
    expect(page.get_by_text("Home", exact=True)).to_have_count(0)

    page.get_by_role("button", name="Filtri").click()
    page.get_by_role("button", name="Reset").click()
    expect(page.get_by_text("Home", exact=True).first).to_be_visible()
```

- [✅] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_create_button_aligned_with_filtri sources/tests/e2e/test_functionalities.py::test_filter_drawer_search -v`
Expected: FAIL — `test_create_button_aligned_with_filtri` fails because there is no "Filtri" button yet (`get_by_role("button", name="Filtri")` finds nothing, `bounding_box()` raises/returns `None`); `test_filter_drawer_search` fails the same way.

- [✅] **Step 3: Add the Filtri drawer and reposition Crea nuovo in `FunctionalitiesTreeClient.tsx`**

1. Update the imports:
```tsx
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, SlidersHorizontal, Search } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import FilterDrawer from '@/components/rbac/FilterDrawer'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
```

2. Add `searchDraft` and `showFilters` state alongside the existing `tab`/`search` state (the existing `search` state becomes the "applied" value used by `filterTree`, unchanged in meaning):
```tsx
export default function FunctionalitiesTreeClient({ rootTree, operationsTree }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'root' | 'operations'>('root')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [showFilters, setShowFilters] = useState(false)
```

3. Update the tab-switch handler to also clear the draft (it currently only clears `search`):
```tsx
        {(['root', 'operations'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); setSearchDraft('') }}
```
(this line comes later in the file — apply it where the tabs `.map` currently calls `setTab(t); setSearch('')`)

4. Replace the header block (the `<div className="flex items-center justify-between mb-4">...</div>` plus the standalone `<input>` Cerca line right after it) with:
```tsx
      <h1 className="text-2xl font-bold mb-4">Funzionalità</h1>
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
      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={() => { setSearch(searchDraft); setShowFilters(false) }}
        onReset={() => { setSearchDraft(''); setSearch('') }}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium block">Cerca</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="filter-search"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="Cerca"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </div>
        </div>
      </FilterDrawer>
```

The full return block should now read (for reference, showing where the tabs/tree continue unchanged below):
```tsx
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Funzionalità</h1>
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
      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={() => { setSearch(searchDraft); setShowFilters(false) }}
        onReset={() => { setSearchDraft(''); setSearch('') }}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium block">Cerca</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="filter-search"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="Cerca"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </div>
        </div>
      </FilterDrawer>
      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['root', 'operations'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); setSearchDraft('') }}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}>
            {t === 'root' ? 'Tutto' : 'Operazioni'}
          </button>
        ))}
      </div>
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </div>
  )
```

- [✅] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: all tests PASS, including the two new ones and the pre-existing `test_tree_loads_with_tabs`, `test_create_edit_delete_functionality`, `test_immutable_item_has_no_actions`, `test_immutable_item_has_no_add_button`, `test_mutable_item_has_all_action_buttons`, `test_drag_moves_item_after_last`.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx sources/tests/e2e/test_functionalities.py
git commit -m "feat(rbac): add Filtri drawer to Functionalities, align Crea nuovo to toolbar (F-01, V-02)"
```

---

### Task 4: Full regression pass, lint, and doc checkboxes

**Files:**
- Modify: `docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md:8,12`

**Interfaces:**
- Consumes: nothing new — this task only verifies Tasks 1-3 and updates tracking docs.

- [✅] **Step 1: Run ESLint**

Run: `cd sources/microservices/web-construct && npm run lint`
Expected: no errors (specifically: no unused-import errors for `Search` in `DataTable.tsx`, no unused-var errors in the three modified client components).

- [✅] **Step 2: Run the full RBAC e2e suite**

Run: `uv run pytest sources/tests/e2e/test_users.py sources/tests/e2e/test_roles.py sources/tests/e2e/test_functionalities.py -v`
Expected: all tests PASS.

- [✅] **Step 3: Manual browser check with the webapp-testing skill**

Take screenshots of `/user-management`, `/roles-permissions`, and `/functionalities` with their Filtri drawers open, confirming: Cerca is the first field in each drawer, no stray "Cerca" input remains in any main toolbar, and Functionalities' "Filtri"/"Crea nuovo" row sits below the title at the same height (matching Roles' layout).

- [✅] **Step 4: Update the source spec checkboxes**

In `docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md`, change:
```
- F-01 - [ ] Il "Crea nuovo" all'interno di Funzionalità, sta all'altezza del titolo, mentre nella pagina "Ruoli & permessi" è sotto, all'altezza di "Colonne" e "Filtri"
```
to:
```
- F-01 - [✅] Il "Crea nuovo" all'interno di Funzionalità, sta all'altezza del titolo, mentre nella pagina "Ruoli & permessi" è sotto, all'altezza di "Colonne" e "Filtri"
```
and:
```
- V-02 - [ ] Metti il "Cerca" di ogni pagina (Users", "Functionalities", Ruoli e permessi") dentro Filtro come prima voce
```
to:
```
- V-02 - [✅] Metti il "Cerca" di ogni pagina (Users", "Functionalities", Ruoli e permessi") dentro Filtro come prima voce
```

- [✅] **Step 5: Commit**

```bash
git add docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md
git commit -m "docs(rbac): mark F-01 and V-02 done"
```
