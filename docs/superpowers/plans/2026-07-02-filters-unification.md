# Filters UI Unification (V-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Roles and Users list-page filter UI into one unified slide-over drawer (title "Filtri", explicit "Reset"/"Applica" buttons), and add the missing Users filters (Ruolo, Stato, Data di creazione) whose backend support already exists but was never exposed in the UI.

**Architecture:** A new generic `FilterDrawer` component (right-side overlay panel) replaces `DataTable`'s current inline collapsible filter box. `DataTable` gains `onApplyFilters`/`onResetFilters` callback props wired to the drawer's footer buttons. Each table client (`RolesTableClient`, `UsersTableClient`) keeps its filter field values as local **draft state**, only pushing them to the URL (via `router.push`) when "Applica" is clicked; "Reset" clears draft state and the URL immediately, without closing the drawer. The existing free-text search box (outside the drawer) is untouched on both pages.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, `react-day-picker` (existing dependency), Supabase JS client, Vitest (unit tests, `environment: 'node'`, no DOM rendering — this codebase does not render components in tests, only pure functions), pytest + Playwright (e2e, `sources/tests/e2e/`).

## Global Constraints

- Target directory for all frontend work: `sources/microservices/web-construct/`.
- Italian UI copy throughout (matches existing app): "Filtri", "Reset", "Applica", "Tutti", "Sì", "No", "Attivo", "Disattivato", "Ruolo", "Stato", "Data di creazione", "Ha permessi".
- No new npm dependencies — reuse `react-day-picker` (already installed) and `lucide-react` icons already in use.
- Follow existing code style: 2-space indent, no semicolons omitted inconsistently — match the surrounding file's existing style exactly (all touched files currently use no-semicolon style).
- Unit tests: Vitest, `environment: 'node'` (see `vitest.config.ts`) — this project does not use React Testing Library / jsdom; only test pure/exported logic functions (e.g. `applyFilters`), not component rendering. Do not add jsdom or RTL as part of this plan.
- E2E tests: `uv run pytest sources/tests/e2e/test_roles.py` / `test_users.py` (never invoke `python`/`pytest` directly — always via `uv run`).
- Run `tsc --noEmit` and `npm run lint` from `sources/microservices/web-construct/` before considering any task done.

---

### Task 1: Extract shared `nextDay` date helper

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/date-utils.ts`
- Create: `sources/microservices/web-construct/lib/rbac/date-utils.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts:18-22` (remove local `nextDay`, import shared one)

**Interfaces:**
- Produces: `nextDay(dateStr: string): string` — given `'YYYY-MM-DD'`, returns the next calendar day as `'YYYY-MM-DD'` (UTC-based, matches existing `roles-service.ts` behavior exactly). Used by Task 9 to fix the Users `createdTo` filter the same way Roles' `endDateIns` was already fixed.

- [✅] **Step 1: Write the failing test**

Create `sources/microservices/web-construct/lib/rbac/date-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { nextDay } from './date-utils'

describe('nextDay', () => {
  it('returns the next calendar day', () => {
    expect(nextDay('2026-06-30')).toBe('2026-07-01')
  })

  it('rolls over month boundaries', () => {
    expect(nextDay('2026-01-31')).toBe('2026-02-01')
  })

  it('rolls over year boundaries', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
```

- [✅] **Step 2: Run test to verify it fails**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/date-utils.test.ts`
Expected: FAIL — `Cannot find module './date-utils'`

- [✅] **Step 3: Create the shared helper**

Create `sources/microservices/web-construct/lib/rbac/date-utils.ts`:

```typescript
export function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
```

- [✅] **Step 4: Run test to verify it passes**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/date-utils.test.ts`
Expected: PASS (3 tests)

- [✅] **Step 5: Point `roles-service.ts` at the shared helper**

In `sources/microservices/web-construct/lib/rbac/roles-service.ts`, remove the local `nextDay` function (lines 18-22):

```typescript
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
```

and add an import at the top of the file (after the existing imports, e.g. after the `./types` import block):

```typescript
import { nextDay } from './date-utils'
```

- [✅] **Step 6: Run the existing roles-service tests to confirm no regression**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/roles-service.test.ts`
Expected: PASS (all existing tests, including the `endDateIns`/next-day-rollover ones, still pass unchanged)

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/date-utils.ts sources/microservices/web-construct/lib/rbac/date-utils.test.ts sources/microservices/web-construct/lib/rbac/roles-service.ts
git commit -m "refactor(rbac): extract nextDay into shared date-utils"
```

---

### Task 2: Backend — support explicit `hasPermission: false` in Roles filter

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts:33` (`applyFilters`)
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.test.ts` (update `hasPermission` coverage)

**Interfaces:**
- Consumes: `RolesQuery.hasPermission?: boolean` (type unchanged — `undefined` still means "no filter", but now `false` is distinguishable from `undefined`).
- Produces: `applyFilters` now calls `.eq('has_permissions', query.hasPermission)` whenever `hasPermission` is `true` or `false` (only skips when `undefined`). Task 7 will be the first caller to actually send `false`.

- [✅] **Step 1: Write the failing test**

In `sources/microservices/web-construct/lib/rbac/roles-service.test.ts`, replace the existing `'combines with existing search and hasPermission filters'` test's expectations are unaffected, but add a new test right after the `hasPermission` usage. Insert this new `it` block right after the `describe('applyFilters', () => {` line (i.e. as the new first test, before `'applies gte/lte on associated_users...'`):

```typescript
  it('applies eq(has_permissions, false) when hasPermission is explicitly false', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, hasPermission: false })
    expect(q.calls).toEqual([{ method: 'eq', column: 'has_permissions', value: false }])
  })

  it('omits the has_permissions filter when hasPermission is undefined', () => {
    const q = makeFakeQuery()
    applyFilters(q, baseQuery)
    expect(q.calls).toEqual([])
  })
```

- [✅] **Step 2: Run test to verify it fails**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/roles-service.test.ts`
Expected: FAIL on `'applies eq(has_permissions, false)...'` — actual calls is `[]` because `if (query.hasPermission)` is falsy for `false`.

- [✅] **Step 3: Fix `applyFilters`**

In `sources/microservices/web-construct/lib/rbac/roles-service.ts`, change line 33:

```typescript
  if (query.hasPermission) r = r.eq('has_permissions', true) as T
```

to:

```typescript
  if (query.hasPermission != null) r = r.eq('has_permissions', query.hasPermission) as T
```

- [✅] **Step 4: Run tests to verify they pass**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/roles-service.test.ts`
Expected: PASS (all tests, including the two new ones and the pre-existing `hasPermission: true` case inside `'combines with existing search...'`)

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/roles-service.ts sources/microservices/web-construct/lib/rbac/roles-service.test.ts
git commit -m "fix(rbac): support explicit hasPermission=false in Roles filter"
```

---

### Task 3: Remove the "Utenti associati" min/max filter

Per the approved design (DEC-3), this filter is dropped entirely — UI, query plumbing, and backend — to match the unified drawer target. This touches 4 files in one task because TypeScript's cross-file prop/type contracts make a partial removal a broken intermediate state.

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts` (`RolesQuery` — remove `minAssociatedUsers`/`maxAssociatedUsers`)
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts:36-37` (`applyFilters`)
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.test.ts` (remove associated-users tests)
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`

**Interfaces:**
- Produces: `RolesTableClient`'s `Props` interface drops `minAssociatedUsers: number | null` and `maxAssociatedUsers: number | null`. `associatedUsers` remains a normal (sortable, displayed) column — only the filter goes away.

- [✅] **Step 1: Remove from `RolesQuery`**

In `sources/microservices/web-construct/lib/rbac/types.ts`, in the `RolesQuery` interface, remove:

```typescript
  minAssociatedUsers?: number
  maxAssociatedUsers?: number
```

- [✅] **Step 2: Remove from `applyFilters`**

In `sources/microservices/web-construct/lib/rbac/roles-service.ts`, remove lines 36-37:

```typescript
  if (query.minAssociatedUsers != null) r = r.gte('associated_users', query.minAssociatedUsers) as T
  if (query.maxAssociatedUsers != null) r = r.lte('associated_users', query.maxAssociatedUsers) as T
```

- [✅] **Step 3: Remove the obsolete tests**

In `sources/microservices/web-construct/lib/rbac/roles-service.test.ts`, delete these four `it` blocks entirely:
- `'applies gte/lte on associated_users when min and max are set'`
- `'applies only gte when only min is set'`
- `'applies only lte when only max is set'`
- `'omits associated_users filters when neither min nor max is set'`

And update the `'combines with existing search and hasPermission filters'` test to drop the now-invalid `minAssociatedUsers` field:

```typescript
  it('combines with existing search and hasPermission filters', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, search: 'Admin', hasPermission: true })
    expect(q.calls).toEqual([
      { method: 'ilike', column: 'description', value: '%Admin%' },
      { method: 'eq', column: 'has_permissions', value: true },
    ])
  })
```

- [✅] **Step 4: Run tests to verify they pass**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/roles-service.test.ts`
Expected: PASS (7 remaining tests: 2 from Task 2 + this file's date-range tests + the updated combined test)

- [✅] **Step 5: Remove from `roles-permissions/page.tsx`**

In `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`, remove the now-unused `parseIntParam` helper (lines 5-9) and its two call sites. The file becomes:

```typescript
import { listRoles } from '@/lib/rbac/roles-service'
import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: RolesQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as RolesQuery['sort']) ?? 'id',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'ASC',
    hasPermission: sp.hasPermission === 'true' || undefined,
    startDateIns: sp.startDateIns,
    endDateIns: sp.endDateIns,
  }
  const { elements, pagination } = await listRoles(query)

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        rows={elements}
        page={pagination.currentPage}
        totalPages={pagination.totalPages}
        sortField={query.sort ?? 'id'}
        sortDir={query.direction ?? 'ASC'}
        search={query.search ?? ''}
        hasPermission={Boolean(query.hasPermission)}
        startDateIns={query.startDateIns ?? null}
        endDateIns={query.endDateIns ?? null}
      />
    </div>
  )
}
```

(Note: `hasPermission` parsing here stays two-way for now — Task 7 upgrades it to three-way alongside the frontend "Ha permessi" redesign.)

- [✅] **Step 6: Remove from `RolesTableClient.tsx`**

In `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`:

1. Remove `minAssociatedUsers: number | null` and `maxAssociatedUsers: number | null` from the `Props` interface (lines 25-26).
2. Remove the `minUsers`/`maxUsers` local state (lines 57-58: `const [minUsers, ...]`, `const [maxUsers, ...]`).
3. Remove their sync in the props-sync `useEffect` (lines 62-67) — it becomes:

```typescript
  useEffect(() => {
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
  }, [props.startDateIns, props.endDateIns])
```

4. Remove the "Utenti associati" min/max `<div>` block from the `filters` JSX (lines 115-128):

```typescript
      <div className="flex items-center gap-2 text-sm">
        <span>Utenti associati</span>
        <input
          type="number" min={0} placeholder="Min" data-testid="filter-min-associated-users"
          value={minUsers} onChange={e => setMinUsers(e.target.value)}
          className="w-20 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span>—</span>
        <input
          type="number" min={0} placeholder="Max" data-testid="filter-max-associated-users"
          value={maxUsers} onChange={e => setMaxUsers(e.target.value)}
          className="w-20 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
      </div>
```

5. In the debounce `useEffect` (lines 69-86), remove `minUsers`/`maxUsers` from the changed-check and from the `setParam` call, and from the dependency array:

```typescript
  useEffect(() => {
    const t = setTimeout(() => {
      const changed = startDate !== props.startDateIns || endDate !== props.endDateIns
      if (changed) {
        setParam({
          startDateIns: startDate || null,
          endDateIns: endDate || null,
          page: '0',
        })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [startDate, endDate, props.startDateIns, props.endDateIns, setParam])
```

(This debounce effect is itself replaced in Task 7 with the Applica/Reset pattern — this step just keeps the file in a working, type-correct state for now.)

- [✅] **Step 7: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 8: Manual browser check**

Run `npm run dev`, log in, open `/roles-permissions`, open "Filtri": confirm only "Ha permessi" and "Data di creazione" remain, and both still filter the table (auto-apply, unchanged behavior at this point).

- [✅] **Step 9: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/types.ts sources/microservices/web-construct/lib/rbac/roles-service.ts sources/microservices/web-construct/lib/rbac/roles-service.test.ts sources/microservices/web-construct/app/\(protected\)/roles-permissions/page.tsx sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx
git commit -m "feat(rbac): drop Utenti associati filter (V-01, DEC-3)"
```

---

### Task 4: Move `CustomSelect` to the shared `components/rbac/` folder

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/CustomSelect.tsx` (moved, unchanged content)
- Delete: `sources/microservices/web-construct/components/rbac/functionalities/CustomSelect.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx:6`

**Interfaces:**
- Produces: `CustomSelect` (default export) and `SelectOption` (named export) from `@/components/rbac/CustomSelect`, same API as today: `{ value, onChange, options, placeholder?, disabled?, title?, 'data-testid'?, className? }`.

- [✅] **Step 1: Move the file**

```bash
cd sources/microservices/web-construct
git mv components/rbac/functionalities/CustomSelect.tsx components/rbac/CustomSelect.tsx
```

- [✅] **Step 2: Update the one existing import**

In `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx`, change line 6:

```typescript
import CustomSelect from './CustomSelect'
```

to:

```typescript
import CustomSelect from '../CustomSelect'
```

- [✅] **Step 3: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 4: Manual browser check**

Run `npm run dev`, open the Functionalities editor for any item, confirm the two `CustomSelect` dropdowns there (e.g. type/parent pickers) still render and work.

- [✅] **Step 5: Commit**

```bash
git add -A sources/microservices/web-construct/components/rbac/CustomSelect.tsx sources/microservices/web-construct/components/rbac/functionalities/CustomSelect.tsx sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx
git commit -m "refactor(rbac): move CustomSelect to shared components/rbac/"
```

---

### Task 5: Build the `FilterDrawer` component

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/FilterDrawer.tsx`

**Interfaces:**
- Produces: `export default function FilterDrawer({ open, onClose, onApply, onReset, children }: { open: boolean; onClose: () => void; onApply: () => void; onReset: () => void; children: React.ReactNode })`. Task 6 wires this into `DataTable`.

- [✅] **Step 1: Create the component**

Create `sources/microservices/web-construct/components/rbac/FilterDrawer.tsx`:

```typescript
'use client'

import React from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onApply: () => void
  onReset: () => void
  children: React.ReactNode
}

export default function FilterDrawer({ open, onClose, onApply, onReset, children }: Props) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Filtri</h2>
          <button
            type="button" onClick={onClose} aria-label="Chiudi filtri"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button" onClick={onReset}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700"
          >
            Reset
          </button>
          <button
            type="button" onClick={onApply} data-testid="filters-apply"
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white"
          >
            Applica
          </button>
        </div>
      </div>
    </>
  )
}
```

- [✅] **Step 2: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors (component isn't wired up anywhere yet, so nothing renders it — this just confirms it compiles cleanly)

- [✅] **Step 3: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/FilterDrawer.tsx
git commit -m "feat(rbac): add FilterDrawer component (V-01)"
```

---

### Task 6: Wire `FilterDrawer` into `DataTable`

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/DataTable.tsx`

**Interfaces:**
- Consumes: `FilterDrawer` from Task 5.
- Produces: `DataTableProps<T>` gains `onApplyFilters?: () => void` and `onResetFilters?: () => void`. Tasks 7 and 10 (`RolesTableClient`, `UsersTableClient`) pass these.

- [✅] **Step 1: Add the import and new props**

In `sources/microservices/web-construct/components/rbac/DataTable.tsx`, add after the existing `lucide-react` import (line 5):

```typescript
import FilterDrawer from './FilterDrawer'
```

In the `DataTableProps<T>` interface, add after `filtersSlot?: React.ReactNode` (line 27):

```typescript
  onApplyFilters?: () => void
  onResetFilters?: () => void
```

In the function's destructuring (line 34-35), add `onApplyFilters, onResetFilters` to the list:

```typescript
  const { columns, rows, rowKey, sort, onSortChange, page, totalPages, onPageChange,
    search, onSearchChange, filtersSlot, actionButton, rowMenu, onRowClick, onApplyFilters, onResetFilters } = props
```

- [✅] **Step 2: Replace the inline filter panel with the drawer**

Replace lines 130-132:

```typescript
      {showFilters && filtersSlot && (
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">{filtersSlot}</div>
      )}
```

with:

```typescript
      {filtersSlot && (
        <FilterDrawer
          open={showFilters}
          onClose={() => setShowFilters(false)}
          onApply={() => { onApplyFilters?.(); setShowFilters(false) }}
          onReset={() => onResetFilters?.()}
        >
          {filtersSlot}
        </FilterDrawer>
      )}
```

- [✅] **Step 3: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 4: Manual browser check**

Run `npm run dev`, open `/roles-permissions`, click "Filtri": confirm the panel now slides in from the right as a full-height overlay with a backdrop, showing "Ha permessi" and "Data di creazione", with "Reset"/"Applica" buttons at the bottom (buttons aren't wired to anything meaningful yet — that's Task 7 — but they must render and be clickable without erroring, and clicking Applica or the X should close the drawer).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/DataTable.tsx
git commit -m "feat(rbac): wire FilterDrawer into DataTable (V-01)"
```

---

### Task 7: Redesign Roles filters — drawer + draft state + Applica/Reset

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`

**Interfaces:**
- Consumes: `CustomSelect` (Task 4) from `@/components/rbac/CustomSelect`; `DataTable`'s `onApplyFilters`/`onResetFilters` (Task 6).
- Produces: `RolesTableClient`'s `hasPermission` prop becomes `boolean | null` (`null` = unset, was previously always `boolean` via `Boolean(...)`).

- [✅] **Step 1: Three-way `hasPermission` parsing in `page.tsx`**

In `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`, change:

```typescript
    hasPermission: sp.hasPermission === 'true' || undefined,
```

to:

```typescript
    hasPermission: sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : undefined,
```

and change the prop passed to `RolesTableClient`:

```typescript
        hasPermission={Boolean(query.hasPermission)}
```

to:

```typescript
        hasPermission={query.hasPermission ?? null}
```

- [✅] **Step 2: Update `RolesTableClient`'s `Props` interface**

In `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`, change:

```typescript
  hasPermission: boolean
```

to:

```typescript
  hasPermission: boolean | null
```

- [✅] **Step 3: Add the `CustomSelect` import and draft `hasPermission` state**

Add near the top imports:

```typescript
import CustomSelect from '@/components/rbac/CustomSelect'
```

Replace the existing date-only draft state block:

```typescript
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)

  useEffect(() => {
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
  }, [props.startDateIns, props.endDateIns])
```

with:

```typescript
  const [hasPermission, setHasPermission] = useState<string>(props.hasPermission == null ? '' : String(props.hasPermission))
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)

  useEffect(() => {
    setHasPermission(props.hasPermission == null ? '' : String(props.hasPermission))
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
  }, [props.hasPermission, props.startDateIns, props.endDateIns])
```

- [✅] **Step 4: Replace the auto-apply debounce effect with explicit Applica/Reset handlers**

Remove the filter-debounce `useEffect` entirely (the one introduced/adjusted in Task 3 Step 6.5, starting `useEffect(() => { const t = setTimeout(() => { const changed = startDate...`).

Add in its place:

```typescript
  const applyFilters = useCallback(() => {
    setParam({
      hasPermission: hasPermission || null,
      startDateIns: startDate || null,
      endDateIns: endDate || null,
      page: '0',
    })
  }, [hasPermission, startDate, endDate, setParam])

  const resetFilters = useCallback(() => {
    setHasPermission('')
    setStartDate(null)
    setEndDate(null)
    setParam({ hasPermission: null, startDateIns: null, endDateIns: null, page: '0' })
  }, [setParam])
```

- [✅] **Step 5: Replace the "Ha permessi" checkbox with `CustomSelect`, restyle as full-width rows**

Replace the `filters` JSX block:

```typescript
  const filters = (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" checked={props.hasPermission}
          onChange={e => setParam({ hasPermission: e.target.checked ? 'true' : null, page: '0' })}
        />
        Ha permessi
      </label>
      <DateRangeFilter
        startDate={startDate} endDate={endDate}
        onChange={(s, e) => { setStartDate(s); setEndDate(e) }}
      />
    </div>
  )
```

with:

```typescript
  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ha permessi</label>
        <CustomSelect
          data-testid="filter-has-permission"
          value={hasPermission}
          onChange={v => setHasPermission(String(v))}
          options={[{ value: 'true', label: 'Sì' }, { value: 'false', label: 'No' }]}
          placeholder="Tutti"
        />
      </div>
      <DateRangeFilter
        startDate={startDate} endDate={endDate}
        onChange={(s, e) => { setStartDate(s); setEndDate(e) }}
      />
    </div>
  )
```

- [✅] **Step 6: Wire `onApplyFilters`/`onResetFilters` into `<DataTable>`**

In the `<DataTable ... />` JSX, add:

```typescript
        filtersSlot={filters}
        onApplyFilters={applyFilters}
        onResetFilters={resetFilters}
```

(insert right after the existing `filtersSlot={filters}` line).

- [✅] **Step 7: Add `useCallback` to the React import if not already present**

Confirm the top of the file imports `useCallback` — it already does (`import React, { useState, useEffect, useCallback } from 'react'`), no change needed.

- [✅] **Step 8: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 9: Manual browser check**

Run `npm run dev`, log in, open `/roles-permissions`:
- Open "Filtri": set "Ha permessi" to "Sì" and pick a "Data di creazione" range, click "Applica" → drawer closes, URL gains `hasPermission=true&startDateIns=...&endDateIns=...`, table narrows.
- Reopen "Filtri", click "Reset" → fields clear, URL loses those params immediately, table shows all rows again, drawer stays open.
- Set "Ha permessi" to "No", click "Applica" → only roles without permissions show; confirm this actually narrows the list (this exercises the Task 2 fix).
- Click the backdrop or the X while a field is changed but not yet applied → drawer closes, URL/table unchanged (pending edit discarded).

- [✅] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/app/\(protected\)/roles-permissions/page.tsx sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx
git commit -m "feat(rbac): redesign Roles filters as drawer with Applica/Reset (V-01)"
```

---

### Task 8: Update Roles e2e tests for the new drawer/Applica flow

**Files:**
- Modify: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Consumes: `get_by_role("button", name="Applica")`, `get_by_role("button", name="Reset")`, existing `data-testid="filter-date-start"`/`"date-popover-start"` (unchanged, from `DateRangeFilter`), new `data-testid="filter-has-permission"` (from `CustomSelect`, Task 7).

- [✅] **Step 1: Remove the obsolete associated-users test**

Delete `test_filter_by_associated_users_range` entirely (lines 87-98 in the original file) — the filter no longer exists (Task 3).

- [✅] **Step 2: Update the date-range test to use the drawer's Applica button**

Replace `test_filter_by_creation_date_range`:

```python
def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E DateFilter {int(time.time())}"
    _create_role(page, base_url, name)

    nav(page, f"{base_url}/roles-permissions")
    page.get_by_placeholder("Cerca").fill(name)
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

(Only change from the original: added `page.get_by_role("button", name="Applica").click()` after picking the date, since filters no longer auto-apply.)

- [✅] **Step 3: Add a test for "Ha permessi" via the new dropdown + Reset**

Add a new test at the end of the file:

```python
def test_filter_by_has_permission_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    baseline = page.locator("tbody tr").count()
    assert baseline > 0

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-has-permission").click()
    page.get_by_test_id("filter-has-permission-option-false").click()
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("hasPermission=false"))
    filtered = page.locator("tbody tr").count()
    assert filtered < baseline

    page.get_by_role("button", name="Filtri").click()
    page.get_by_role("button", name="Reset").click()
    expect(page.locator("tbody tr")).to_have_count(baseline)
```

- [✅] **Step 4: Run the updated e2e suite**

Run: `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: all tests PASS (requires `npm run dev` running against `BASE_URL`, and `TEST_EMAIL` configured per `sources/tests/e2e/.env.test` — same preconditions as before this change)

- [✅] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_roles.py
git commit -m "test(rbac): update Roles e2e for filter drawer + Applica/Reset"
```

---

### Task 9: Backend — Users date-range filter fix + testable `applyUserFilters`

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/users-service.ts`
- Create: `sources/microservices/web-construct/lib/rbac/users-service.test.ts`

**Interfaces:**
- Consumes: `nextDay` from `./date-utils` (Task 1).
- Produces: `export function applyUserFilters<T extends FilterableQuery>(q: T, query: UsersQuery, ids: string[] | null): T` (was previously unexported — Task 10's frontend work doesn't need this export, but it makes the fix unit-testable, matching the `roles-service.ts` convention).

- [✅] **Step 1: Write the failing test**

Create `sources/microservices/web-construct/lib/rbac/users-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { applyUserFilters } from './users-service'
import type { UsersQuery } from './types'

interface Call { method: string; args: unknown[] }

function makeFakeQuery() {
  const calls: Call[] = []
  const q = {
    calls,
    ilike(...args: unknown[]) { calls.push({ method: 'ilike', args }); return q },
    or(...args: unknown[]) { calls.push({ method: 'or', args }); return q },
    in(...args: unknown[]) { calls.push({ method: 'in', args }); return q },
    gte(...args: unknown[]) { calls.push({ method: 'gte', args }); return q },
    lte(...args: unknown[]) { calls.push({ method: 'lte', args }); return q },
    lt(...args: unknown[]) { calls.push({ method: 'lt', args }); return q },
  }
  return q
}

const baseQuery: UsersQuery = { page: 0, size: 10 }

describe('applyUserFilters', () => {
  it('applies gte on created_at when createdFrom is set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, createdFrom: '2026-06-01' }, null)
    expect(q.calls).toEqual([{ method: 'gte', args: ['created_at', '2026-06-01'] }])
  })

  it('applies lt on created_at with the next-day value when createdTo is set, to include the full end day', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, createdTo: '2026-06-30' }, null)
    expect(q.calls).toEqual([{ method: 'lt', args: ['created_at', '2026-07-01'] }])
  })

  it('applies in(id_user_status) when statuses is set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, { ...baseQuery, statuses: [2] }, null)
    expect(q.calls).toEqual([{ method: 'in', args: ['id_user_status', [2]] }])
  })

  it('applies in(id) when a candidate id list is passed', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, baseQuery, ['abc', 'def'])
    expect(q.calls).toEqual([{ method: 'in', args: ['id', ['abc', 'def']] }])
  })

  it('applies nothing when no filters are set', () => {
    const q = makeFakeQuery()
    applyUserFilters(q, baseQuery, null)
    expect(q.calls).toEqual([])
  })
})
```

- [✅] **Step 2: Run test to verify it fails**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/users-service.test.ts`
Expected: FAIL — `applyUserFilters` is not exported from `./users-service`.

- [✅] **Step 3: Export `applyUserFilters`, add `lt`, and fix `createdTo`**

In `sources/microservices/web-construct/lib/rbac/users-service.ts`:

1. Add the import (after the existing `type { UserDTO, UsersQuery }` import):

```typescript
import { nextDay } from './date-utils'
```

2. Add `lt` to the `FilterableQuery` type:

```typescript
type FilterableQuery = {
  ilike(column: string, value: string): FilterableQuery
  or(filters: string): FilterableQuery
  in(column: string, values: readonly unknown[]): FilterableQuery
  gte(column: string, value: unknown): FilterableQuery
  lte(column: string, value: unknown): FilterableQuery
  lt(column: string, value: unknown): FilterableQuery
}
```

3. Export the function and fix `createdTo`:

```typescript
export function applyUserFilters<T extends FilterableQuery>(q: T, query: UsersQuery, ids: string[] | null): T {
  let r = q
  if (query.search) {
    const s = query.search.replace(/[%,()&]/g, '')
    r = r.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`) as T
  }
  if (query.statuses?.length) r = r.in('id_user_status', query.statuses) as T
  if (query.createdFrom) r = r.gte('created_at', query.createdFrom) as T
  if (query.createdTo) r = r.lt('created_at', nextDay(query.createdTo)) as T
  if (ids) r = r.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) as T
  return r
}
```

(Only functional change from today: `lte('created_at', query.createdTo)` → `lt('created_at', nextDay(query.createdTo))`, matching the Roles fix from commit `65997d3`.)

- [✅] **Step 4: Run tests to verify they pass**

Run: `cd sources/microservices/web-construct && npm run test -- lib/rbac/users-service.test.ts`
Expected: PASS (5 tests)

- [✅] **Step 5: Run the full unit suite to confirm no regressions elsewhere**

Run: `cd sources/microservices/web-construct && npm run test`
Expected: all tests PASS

- [✅] **Step 6: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/users-service.ts sources/microservices/web-construct/lib/rbac/users-service.test.ts
git commit -m "fix(rbac): make Users createdTo filter inclusive of the full end day"
```

---

### Task 10: Add the Users filter drawer (Ruolo, Stato, Data di creazione)

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/user-management/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`

**Interfaces:**
- Consumes: `CustomSelect` (Task 4), `DateRangeFilter` (existing, from `@/components/rbac/roles/DateRangeFilter`), `DataTable`'s `onApplyFilters`/`onResetFilters` (Task 6), `USER_STATUS_ACTIVE`/`USER_STATUS_DEACTIVATED` (existing, from `@/lib/rbac/types`).
- Produces: `UsersTableClient`'s `Props` gains `roleId: number | null`, `statusId: number | null`, `createdFrom: string | null`, `createdTo: string | null`.

- [✅] **Step 1: Parse the new query params in `page.tsx`**

In `sources/microservices/web-construct/app/(protected)/user-management/page.tsx`, add `createdFrom`/`createdTo` to the `UsersQuery` object:

```typescript
export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: UsersQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as UsersQuery['sort']) ?? 'dateIns',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'DESC',
    roleIds: sp.roleIds ? sp.roleIds.split(',').map(Number) : undefined,
    statuses: sp.statuses ? (sp.statuses.split(',').map(Number) as UserStatusId[]) : undefined,
    createdFrom: sp.createdFrom,
    createdTo: sp.createdTo,
  }
  const [{ users, total }, allRolesRaw] = await Promise.all([listUsers(query), getAllRoles()])
  const totalPages = Math.max(1, Math.ceil(total / query.size))
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Utenti</h1>
      <UsersTableClient
        rows={users}
        page={query.page}
        totalPages={totalPages}
        sortField={query.sort ?? 'dateIns'}
        sortDir={query.direction ?? 'DESC'}
        search={query.search ?? ''}
        allRoles={allRoles}
        roleId={query.roleIds?.[0] ?? null}
        statusId={query.statuses?.[0] ?? null}
        createdFrom={query.createdFrom ?? null}
        createdTo={query.createdTo ?? null}
      />
    </div>
  )
}
```

- [✅] **Step 2: Rewrite `UsersTableClient.tsx`**

Replace the full contents of `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`:

```typescript
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import CustomSelect from '@/components/rbac/CustomSelect'
import DateRangeFilter from '@/components/rbac/roles/DateRangeFilter'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from '@/lib/rbac/types'

interface Props {
  rows: UserDTO[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  allRoles: { id: number; name: string }[]
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
}

export default function UsersTableClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { p.delete(k) } else { p.set(k, v) } }
    if (!('page' in updates)) p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }, [sp, pathname, router])

  const [roleId, setRoleId] = useState<string>(props.roleId == null ? '' : String(props.roleId))
  const [statusId, setStatusId] = useState<string>(props.statusId == null ? '' : String(props.statusId))
  const [createdFrom, setCreatedFrom] = useState(props.createdFrom)
  const [createdTo, setCreatedTo] = useState(props.createdTo)

  useEffect(() => {
    setRoleId(props.roleId == null ? '' : String(props.roleId))
    setStatusId(props.statusId == null ? '' : String(props.statusId))
    setCreatedFrom(props.createdFrom)
    setCreatedTo(props.createdTo)
  }, [props.roleId, props.statusId, props.createdFrom, props.createdTo])

  const applyFilters = useCallback(() => {
    setParam({
      roleIds: roleId || null,
      statuses: statusId || null,
      createdFrom: createdFrom || null,
      createdTo: createdTo || null,
      page: '0',
    })
  }, [roleId, statusId, createdFrom, createdTo, setParam])

  const resetFilters = useCallback(() => {
    setRoleId('')
    setStatusId('')
    setCreatedFrom(null)
    setCreatedTo(null)
    setParam({ roleIds: null, statuses: null, createdFrom: null, createdTo: null, page: '0' })
  }, [setParam])

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === USER_STATUS_ACTIVE ? USER_STATUS_DEACTIVATED : USER_STATUS_ACTIVE
    if (!confirm(next === USER_STATUS_DEACTIVATED ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
    try { await setUserStatus(u.id, next); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const columns: Column<UserDTO>[] = [
    { key: 'firstName', header: 'Utente', sortable: true, render: u => fullName(u) },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'roles', header: 'Ruoli', render: u => u.roles.map(r => r.name).join(', ') || '—' },
    { key: 'status', header: 'Stato', sortable: true, render: u => <StatusBadge status={u.status} onToggle={() => toggleStatus(u)} /> },
    { key: 'dateIns', header: 'Creato', sortable: true, render: u => new Date(u.createdAt).toLocaleDateString() },
    { key: 'dateMod', header: 'Aggiornato', sortable: true, render: u => u.updatedAt ? new Date(u.updatedAt).toLocaleDateString() : '—' },
  ]

  const filters = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium block">Ruolo</label>
        <CustomSelect
          data-testid="filter-role"
          value={roleId}
          onChange={v => setRoleId(String(v))}
          options={props.allRoles.map(r => ({ value: r.id, label: r.name }))}
          placeholder="Tutti"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium block">Stato</label>
        <CustomSelect
          data-testid="filter-status"
          value={statusId}
          onChange={v => setStatusId(String(v))}
          options={[
            { value: USER_STATUS_ACTIVE, label: 'Attivo' },
            { value: USER_STATUS_DEACTIVATED, label: 'Disattivato' },
          ]}
          placeholder="Tutti"
        />
      </div>
      <DateRangeFilter
        startDate={createdFrom} endDate={createdTo}
        onChange={(s, e) => { setCreatedFrom(s); setCreatedTo(e) }}
      />
    </div>
  )

  return (
    <>
      <DataTable<UserDTO>
        columns={columns}
        rows={props.rows}
        rowKey={u => u.id}
        sort={{ field: props.sortField, direction: props.sortDir }}
        onSortChange={f => {
          const dir = props.sortField === f && props.sortDir === 'ASC' ? 'DESC' : 'ASC'
          setParam({ sort: f, direction: dir })
        }}
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={n => setParam({ page: String(n) })}
        search={props.search}
        onSearchChange={v => setParam({ search: v || null })}
        rowMenu={u => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }]}
        filtersSlot={filters}
        onApplyFilters={applyFilters}
        onResetFilters={resetFilters}
      />
      {managing && (
        <ManageRolesModal
          user={managing}
          allRoles={props.allRoles}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); router.refresh() }}
        />
      )}
    </>
  )
}
```

Note the `setParam` signature changes from `(k: string, v: string | null)` to `(updates: Record<string, string | null>)` to match `RolesTableClient`'s pattern (needed since Applica now commits four fields at once) — the `onSortChange`/`onPageChange`/`onSearchChange` call sites above are updated accordingly to pass an object.

- [✅] **Step 3: Type-check and lint**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint`
Expected: no errors

- [✅] **Step 4: Manual browser check**

Run `npm run dev`, log in, open `/user-management`:
- Confirm the "Filtri" button now appears (it didn't before) and opens the drawer with "Ruolo", "Stato", "Data di creazione".
- Pick a role, click "Applica" → URL gains `roleIds=<id>`, table narrows to users with that role.
- Pick "Disattivato" for Stato, click "Applica" → table narrows to deactivated users only.
- Pick a "Data di creazione" range covering today, click "Applica" → any user created today is included (exercises the Task 9 fix).
- Click "Reset" → all three fields clear and the URL/table reset immediately, drawer stays open.
- Confirm the free-text search box still works as before (unaffected).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/app/\(protected\)/user-management/page.tsx sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx
git commit -m "feat(rbac): add Users filter drawer — Ruolo, Stato, Data di creazione (V-01)"
```

---

### Task 11: Add Users e2e tests for the new filters

**Files:**
- Modify: `sources/tests/e2e/test_users.py`

**Interfaces:**
- Consumes: `data-testid="filter-role"`, `filter-role-option-<id>`, `filter-status`, `filter-status-option-<id>` (from `CustomSelect`, Task 10), `get_by_role("button", name="Filtri"|"Applica"|"Reset")`.

- [✅] **Step 1: Add filter tests**

Append to `sources/tests/e2e/test_users.py`:

```python
def test_filter_by_status_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    baseline = page.locator('[data-testid="status-badge"]').count()
    assert baseline > 0

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-status").click()
    page.get_by_test_id("filter-status-option-1").click()  # 1 = Deactivated
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("statuses=1"))

    page.get_by_role("button", name="Filtri").click()
    page.get_by_role("button", name="Reset").click()
    expect(page).not_to_have_url(re.compile("statuses="))
    expect(page.locator('[data-testid="status-badge"]')).to_have_count(baseline)


def test_filter_by_role(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-role").click()
    page.get_by_test_id("filter-role-option-0").click()  # 0 = Registered user, every user has it
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("roleIds=0"))
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()
```

Add `import re` at the top of the file if not already present (it is not, in the current file) — insert it as the first line.

- [✅] **Step 2: Run the updated e2e suite**

Run: `uv run pytest sources/tests/e2e/test_users.py -v`
Expected: all tests PASS

- [✅] **Step 3: Commit**

```bash
git add sources/tests/e2e/test_users.py
git commit -m "test(rbac): add e2e coverage for Users filter drawer (V-01)"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [✅] **Step 1: Full type-check**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit`
Expected: no errors

- [✅] **Step 2: Full lint**

Run: `cd sources/microservices/web-construct && npm run lint`
Expected: no errors

- [✅] **Step 3: Full unit test suite**

Run: `cd sources/microservices/web-construct && npm run test`
Expected: all tests PASS

- [✅] **Step 4: Full e2e suite**

Run: `uv run pytest sources/tests/e2e/`
Expected: all tests PASS

- [✅] **Step 5: Manual end-to-end browser walkthrough**

Run `npm run dev`, log in, and confirm on both `/roles-permissions` and `/user-management`:
- "Filtri" opens a right-side drawer titled "Filtri" with a close (X), each with its own field set, and a "Reset"/"Applica" footer.
- Filters only take effect on "Applica"; "Reset" clears and applies immediately without closing the drawer; backdrop/X discards unapplied edits.
- Combining multiple filters (e.g. Roles: "Ha permessi" + date range; Users: "Ruolo" + "Stato" + date range) narrows the table correctly.
- The free-text search box on both pages still works exactly as before.
- No console errors in the browser dev tools while exercising the above.

- [✅] **Step 6: Update the source input-spec checkbox**

In `docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md`, change:

```markdown
- V-01 - [ ] Cambiare e uniformare la pagina sui filtri
```

to:

```markdown
- V-01 - [✅] Cambiare e uniformare la pagina sui filtri
```

- [✅] **Step 7: Commit**

```bash
git add docs/input-specs/rbac-additional-fixes/rbac-additional-fixes.md
git commit -m "docs(rbac): close V-01 — filters UI unification"
```
