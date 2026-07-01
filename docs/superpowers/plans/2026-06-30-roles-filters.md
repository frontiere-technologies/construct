# Roles & Permissions Filters (R-03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two filters to the Roles & Permissions list's "Filtri" drawer — a min/max range on "Utenti associati" (associated users) and a creation-date range picked via a calendar widget.

**Architecture:** Both filters follow the existing `RolesTableClient` pattern: local input state → debounced (~350ms) `setParam()` → URL search params → `page.tsx` Server Component reads params into a `RolesQuery` → `listRoles()` (Supabase query via `role_list_view`). The date range filter is the only new piece of UI infrastructure: a small client component wrapping two `react-day-picker` popovers.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase (`@supabase/supabase-js`), `react-day-picker` (new dependency), Vitest (unit tests), pytest + Playwright (E2E).

## Global Constraints

- All new UI copy is in Italian, matching the existing page (e.g. "Utenti associati", "Data di creazione", "Cerca").
- New filters debounce ~350ms before updating the URL, exactly like the existing search box in `RolesTableClient.tsx:44-50` — no explicit "Apply" button (design DEC-4).
- The date filter applies to `dateIns` (creation date) only; `dateMod` is out of scope (design DEC-2).
- `react-day-picker` is the calendar library (design DEC-3); import its CSS from `react-day-picker/style.css` and its Italian locale from `react-day-picker/locale`.
- Run `npx tsc --noEmit` and `npm run lint` from `sources/microservices/web-construct/` after every task — both must stay clean (0 errors).

---

## Task 1: Backend — `associatedUsers` min/max filter

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts:87-96` (`RolesQuery` interface)
- Modify: `sources/microservices/web-construct/lib/rbac/roles-service.ts:18-30` (`applyFilters`)
- Test: `sources/microservices/web-construct/lib/rbac/roles-service.test.ts` (new file)

**Interfaces:**
- Produces: `RolesQuery.minAssociatedUsers?: number`, `RolesQuery.maxAssociatedUsers?: number` — consumed by Task 2's `page.tsx` changes.
- Produces: `export function applyFilters<T>(q: T, query: RolesQuery): T` (currently unexported) — consumed only by this task's own test.

- [ ] **Step 1: Write the failing test**

Create `sources/microservices/web-construct/lib/rbac/roles-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { applyFilters } from './roles-service'
import type { RolesQuery } from './types'

interface Call { method: string; column: string; value: unknown }

function makeFakeQuery() {
  const calls: Call[] = []
  const q = {
    calls,
    ilike(column: string, value: unknown) { calls.push({ method: 'ilike', column, value }); return q },
    eq(column: string, value: unknown) { calls.push({ method: 'eq', column, value }); return q },
    gte(column: string, value: unknown) { calls.push({ method: 'gte', column, value }); return q },
    lte(column: string, value: unknown) { calls.push({ method: 'lte', column, value }); return q },
  }
  return q
}

const baseQuery: RolesQuery = { page: 0, size: 10 }

describe('applyFilters', () => {
  it('applies gte/lte on associated_users when min and max are set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, minAssociatedUsers: 5, maxAssociatedUsers: 20 })
    expect(q.calls).toEqual([
      { method: 'gte', column: 'associated_users', value: 5 },
      { method: 'lte', column: 'associated_users', value: 20 },
    ])
  })

  it('applies only gte when only min is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, minAssociatedUsers: 5 })
    expect(q.calls).toEqual([{ method: 'gte', column: 'associated_users', value: 5 }])
  })

  it('applies only lte when only max is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, maxAssociatedUsers: 20 })
    expect(q.calls).toEqual([{ method: 'lte', column: 'associated_users', value: 20 }])
  })

  it('omits associated_users filters when neither min nor max is set', () => {
    const q = makeFakeQuery()
    applyFilters(q, baseQuery)
    expect(q.calls).toEqual([])
  })

  it('combines with existing search and hasPermission filters', () => {
    const q = makeFakeQuery()
    applyFilters(q, { ...baseQuery, search: 'Admin', hasPermission: true, minAssociatedUsers: 1 })
    expect(q.calls).toEqual([
      { method: 'ilike', column: 'description', value: '%Admin%' },
      { method: 'eq', column: 'has_permissions', value: true },
      { method: 'gte', column: 'associated_users', value: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `sources/microservices/web-construct/`): `npx vitest run lib/rbac/roles-service.test.ts`
Expected: FAIL — `applyFilters` is not exported from `./roles-service` (or `minAssociatedUsers`/`maxAssociatedUsers` don't exist on `RolesQuery`, a TS error).

- [ ] **Step 3: Add the new query fields**

In `sources/microservices/web-construct/lib/rbac/types.ts`, change:

```typescript
export interface RolesQuery {
  page: number
  size: number
  search?: string
  sort?: 'id' | 'description' | 'associatedUsers' | 'hasPermissions' | 'dateIns' | 'dateMod'
  direction?: 'ASC' | 'DESC'
  hasPermission?: boolean
  startDateIns?: string
  endDateIns?: string
}
```

to:

```typescript
export interface RolesQuery {
  page: number
  size: number
  search?: string
  sort?: 'id' | 'description' | 'associatedUsers' | 'hasPermissions' | 'dateIns' | 'dateMod'
  direction?: 'ASC' | 'DESC'
  hasPermission?: boolean
  startDateIns?: string
  endDateIns?: string
  minAssociatedUsers?: number
  maxAssociatedUsers?: number
}
```

- [ ] **Step 4: Export and extend `applyFilters`**

In `sources/microservices/web-construct/lib/rbac/roles-service.ts`, change:

```typescript
function applyFilters<T extends {
  ilike(column: string, value: string): T
  eq(column: string, value: unknown): T
  gte(column: string, value: unknown): T
  lte(column: string, value: unknown): T
}>(q: T, query: RolesQuery): T {
  let r = q
  if (query.search) r = r.ilike('description', `%${query.search}%`) as T
  if (query.hasPermission) r = r.eq('has_permissions', true) as T
  if (query.startDateIns) r = r.gte('date_ins', query.startDateIns) as T
  if (query.endDateIns) r = r.lte('date_ins', query.endDateIns) as T
  return r
}
```

to:

```typescript
export function applyFilters<T extends {
  ilike(column: string, value: string): T
  eq(column: string, value: unknown): T
  gte(column: string, value: unknown): T
  lte(column: string, value: unknown): T
}>(q: T, query: RolesQuery): T {
  let r = q
  if (query.search) r = r.ilike('description', `%${query.search}%`) as T
  if (query.hasPermission) r = r.eq('has_permissions', true) as T
  if (query.startDateIns) r = r.gte('date_ins', query.startDateIns) as T
  if (query.endDateIns) r = r.lte('date_ins', query.endDateIns) as T
  if (query.minAssociatedUsers != null) r = r.gte('associated_users', query.minAssociatedUsers) as T
  if (query.maxAssociatedUsers != null) r = r.lte('associated_users', query.maxAssociatedUsers) as T
  return r
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/rbac/roles-service.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors (pre-existing warnings in unrelated files are fine).

- [ ] **Step 7: Commit**

```bash
git add lib/rbac/types.ts lib/rbac/roles-service.ts lib/rbac/roles-service.test.ts
git commit -m "feat(rbac): add associatedUsers min/max filter to listRoles (R-03.02)"
```

---

## Task 2: Frontend — "Utenti associati" min/max filter UI

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`
- Test: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Consumes: `RolesQuery.minAssociatedUsers?: number`, `RolesQuery.maxAssociatedUsers?: number` (Task 1).
- Produces: `RolesTableClientProps.minAssociatedUsers: number | null`, `RolesTableClientProps.maxAssociatedUsers: number | null` — Task 4 will add sibling props for the date filter to this same `Props` interface.

- [ ] **Step 1: Write the failing E2E test**

Add to `sources/tests/e2e/test_roles.py` (after the existing tests, keep the `time` and `nav`/`expect` imports already there):

```python
def test_filter_by_associated_users_range(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    baseline = page.locator("tbody tr").count()
    assert baseline > 0

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-min-associated-users").fill("999999")
    expect(page.locator("tbody tr")).to_have_count(0)

    page.get_by_test_id("filter-min-associated-users").fill("")
    expect(page.locator("tbody tr")).to_have_count(baseline)
```

- [ ] **Step 2: Run test to verify it fails**

Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py::test_filter_by_associated_users_range -v`
Expected: FAIL — `get_by_test_id("filter-min-associated-users")` finds no element (the filter doesn't exist yet) or `get_by_role("button", name="Filtri")` times out because there's no second filter to make "Filtri" panel meaningfully different — actually "Filtri" button already exists from the "Ha permessi" filter, so the failure will be specifically the missing `filter-min-associated-users` test id, timing out after the default Playwright timeout.

- [ ] **Step 3: Read the new params in `page.tsx`**

In `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`, change:

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
      />
    </div>
  )
}
```

to:

```typescript
import { listRoles } from '@/lib/rbac/roles-service'
import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

function parseIntParam(v?: string): number | undefined {
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: RolesQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as RolesQuery['sort']) ?? 'id',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'ASC',
    hasPermission: sp.hasPermission === 'true' || undefined,
    minAssociatedUsers: parseIntParam(sp.minAssociatedUsers),
    maxAssociatedUsers: parseIntParam(sp.maxAssociatedUsers),
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
        minAssociatedUsers={query.minAssociatedUsers ?? null}
        maxAssociatedUsers={query.maxAssociatedUsers ?? null}
        startDateIns={query.startDateIns ?? null}
        endDateIns={query.endDateIns ?? null}
      />
    </div>
  )
}
```

(`startDateIns`/`endDateIns` are wired here now too, even though the date-picker UI itself lands in Task 4, so `page.tsx` only needs touching once.)

- [ ] **Step 4: Add the new props and filter UI to `RolesTableClient.tsx`**

In `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`, change the `Props` interface:

```typescript
interface Props {
  rows: RolePageItemDto[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean
}
```

to:

```typescript
interface Props {
  rows: RolePageItemDto[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean
  minAssociatedUsers: number | null
  maxAssociatedUsers: number | null
  startDateIns: string | null
  endDateIns: string | null
}
```

Add local state and a debounced sync effect, right after the existing search state/effects (after the block ending `}, [search, props.search, setParam])` around line 50):

```typescript
  const [minUsers, setMinUsers] = useState(props.minAssociatedUsers?.toString() ?? '')
  const [maxUsers, setMaxUsers] = useState(props.maxAssociatedUsers?.toString() ?? '')

  useEffect(() => {
    setMinUsers(props.minAssociatedUsers?.toString() ?? '')
    setMaxUsers(props.maxAssociatedUsers?.toString() ?? '')
  }, [props.minAssociatedUsers, props.maxAssociatedUsers])

  useEffect(() => {
    const t = setTimeout(() => {
      const prevMin = props.minAssociatedUsers?.toString() ?? ''
      const prevMax = props.maxAssociatedUsers?.toString() ?? ''
      if (minUsers !== prevMin || maxUsers !== prevMax) {
        setParam({ minAssociatedUsers: minUsers || null, maxAssociatedUsers: maxUsers || null, page: '0' })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [minUsers, maxUsers, props.minAssociatedUsers, props.maxAssociatedUsers, setParam])
```

Add the input fields to the `filters` JSX. Change:

```typescript
  const filters = (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox" checked={props.hasPermission}
        onChange={e => setParam({ hasPermission: e.target.checked ? 'true' : null, page: '0' })}
      />
      Ha permessi
    </label>
  )
```

to:

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
    </div>
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py::test_filter_by_associated_users_range -v`
Expected: PASS.

- [ ] **Step 6: Type-check, lint, and run the full Roles E2E file**

Run (from `sources/microservices/web-construct/`): `npx tsc --noEmit && npm run lint`
Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: 0 type/lint errors; all tests in `test_roles.py` pass.

- [ ] **Step 7: Commit**

```bash
git add app/\(protected\)/roles-permissions/page.tsx components/rbac/roles/RolesTableClient.tsx
git add ../../tests/e2e/test_roles.py
git commit -m "feat(rbac): add Utenti associati min/max filter UI (R-03.02)"
```

---

## Task 3: `react-day-picker` dependency + `DateRangeFilter` component

**Files:**
- Modify: `sources/microservices/web-construct/package.json` (new dependency)
- Create: `sources/microservices/web-construct/components/rbac/roles/DateRangeFilter.tsx`
- Test: `sources/microservices/web-construct/components/rbac/roles/DateRangeFilter.test.tsx` (new file)

**Interfaces:**
- Produces: `export default function DateRangeFilter(props: { startDate: string | null; endDate: string | null; onChange: (startDate: string | null, endDate: string | null) => void }): JSX.Element` — consumed by Task 4's `RolesTableClient.tsx` change.
- Internal pure helpers `toIso(d: Date | undefined): string | null` and `fromIso(s: string | null): Date | undefined` are exported from the same file for the unit test.

- [ ] **Step 1: Install the dependency**

Run (from `sources/microservices/web-construct/`): `npm install react-day-picker@^10.0.1`
Expected: `package.json`/`package-lock.json` updated, install succeeds with no peer-dependency conflicts (it declares `react: >=16.8.0`, compatible with React 19).

- [ ] **Step 2: Write the failing unit test for the date helpers**

Create `sources/microservices/web-construct/components/rbac/roles/DateRangeFilter.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { toIso, fromIso } from './DateRangeFilter'

describe('toIso', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(toIso(new Date(2026, 5, 30))).toBe('2026-06-30')
  })
  it('returns null for undefined', () => {
    expect(toIso(undefined)).toBeNull()
  })
})

describe('fromIso', () => {
  it('parses a YYYY-MM-DD string into a Date', () => {
    const d = fromIso('2026-06-30')
    expect(d).toBeInstanceOf(Date)
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(5)
    expect(d?.getDate()).toBe(30)
  })
  it('returns undefined for null', () => {
    expect(fromIso(null)).toBeUndefined()
  })
  it('returns undefined for an invalid string', () => {
    expect(fromIso('not-a-date')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run components/rbac/roles/DateRangeFilter.test.tsx`
Expected: FAIL — `./DateRangeFilter` doesn't exist yet.

- [ ] **Step 4: Create `DateRangeFilter.tsx`**

Create `sources/microservices/web-construct/components/rbac/roles/DateRangeFilter.tsx`:

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
import { it } from 'react-day-picker/locale'
import 'react-day-picker/style.css'

export function toIso(d: Date | undefined): string | null {
  if (!d) return null
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromIso(s: string | null): Date | undefined {
  if (!s) return undefined
  const [year, month, day] = s.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const d = new Date(year, month - 1, day)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function fmtIt(s: string | null): string {
  const d = fromIso(s)
  return d ? d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

interface Props {
  startDate: string | null
  endDate: string | null
  onChange: (startDate: string | null, endDate: string | null) => void
}

export default function DateRangeFilter({ startDate, endDate, onChange }: Props) {
  const [openField, setOpenField] = useState<'start' | 'end' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenField(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="flex items-center gap-2 text-sm">
      <span>Data di creazione</span>
      <div className="relative">
        <button
          type="button" data-testid="filter-date-start"
          onClick={() => setOpenField(f => (f === 'start' ? null : 'start'))}
          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-w-20 text-left"
        >
          {fmtIt(startDate) || 'Da'}
        </button>
        {openField === 'start' && (
          <div
            data-testid="date-popover-start"
            className="absolute z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
          >
            <DayPicker
              mode="single" locale={it} showOutsideDays={false}
              selected={fromIso(startDate)}
              onSelect={d => { onChange(toIso(d), endDate); setOpenField(null) }}
            />
          </div>
        )}
      </div>
      <span>—</span>
      <div className="relative">
        <button
          type="button" data-testid="filter-date-end"
          onClick={() => setOpenField(f => (f === 'end' ? null : 'end'))}
          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-w-20 text-left"
        >
          {fmtIt(endDate) || 'A'}
        </button>
        {openField === 'end' && (
          <div
            data-testid="date-popover-end"
            className="absolute z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
          >
            <DayPicker
              mode="single" locale={it} showOutsideDays={false}
              selected={fromIso(endDate)}
              onSelect={d => { onChange(startDate, toIso(d)); setOpenField(null) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run components/rbac/roles/DateRangeFilter.test.tsx`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors. (If `react-day-picker/locale` doesn't resolve a named export `it` under the installed version, swap to no `locale` prop — English-labeled calendar — and note it in the commit message; this is a cosmetic fallback, not a blocker.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json components/rbac/roles/DateRangeFilter.tsx components/rbac/roles/DateRangeFilter.test.tsx
git commit -m "feat(rbac): add DateRangeFilter component (react-day-picker) for R-03.01"
```

---

## Task 4: Wire `DateRangeFilter` into the Roles list + E2E test

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`
- Test: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Consumes: `DateRangeFilter` (Task 3); `Props.startDateIns`/`Props.endDateIns` (already added to the `Props` interface in Task 2, Step 4).

- [x] **Step 1: Write the failing E2E test**

Add to `sources/tests/e2e/test_roles.py`:

```python
from datetime import date


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

    # The role we just created was created today, so it must still match startDateIns = today
    expect(page.locator("tr").filter(has_text=name)).to_have_count(1)
    expect(page).to_have_url(lambda url: "startDateIns=" in url)

    _delete_role(page, base_url, name)
```

(Move `from datetime import date` to the top of the file with the other imports if the test runner/linter complains about a non-top-level import — keep it grouped with `import time`.)

- [x] **Step 2: Run test to verify it fails**

Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py::test_filter_by_creation_date_range -v`
Expected: FAIL — `get_by_test_id("filter-date-start")` finds no element.

- [x] **Step 3: Add local state and wire `DateRangeFilter` into `RolesTableClient.tsx`**

Add the import near the top of `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`:

```typescript
import DateRangeFilter from './DateRangeFilter'
```

Add local state and a debounced sync effect, alongside the `minUsers`/`maxUsers` state added in Task 2 (so both effects can be merged into one — replace the Task 2 effects with this combined version):

```typescript
  const [minUsers, setMinUsers] = useState(props.minAssociatedUsers?.toString() ?? '')
  const [maxUsers, setMaxUsers] = useState(props.maxAssociatedUsers?.toString() ?? '')
  const [startDate, setStartDate] = useState(props.startDateIns)
  const [endDate, setEndDate] = useState(props.endDateIns)

  useEffect(() => {
    setMinUsers(props.minAssociatedUsers?.toString() ?? '')
    setMaxUsers(props.maxAssociatedUsers?.toString() ?? '')
    setStartDate(props.startDateIns)
    setEndDate(props.endDateIns)
  }, [props.minAssociatedUsers, props.maxAssociatedUsers, props.startDateIns, props.endDateIns])

  useEffect(() => {
    const t = setTimeout(() => {
      const prevMin = props.minAssociatedUsers?.toString() ?? ''
      const prevMax = props.maxAssociatedUsers?.toString() ?? ''
      const changed = minUsers !== prevMin || maxUsers !== prevMax
        || startDate !== props.startDateIns || endDate !== props.endDateIns
      if (changed) {
        setParam({
          minAssociatedUsers: minUsers || null,
          maxAssociatedUsers: maxUsers || null,
          startDateIns: startDate || null,
          endDateIns: endDate || null,
          page: '0',
        })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [minUsers, maxUsers, startDate, endDate, props.minAssociatedUsers, props.maxAssociatedUsers, props.startDateIns, props.endDateIns, setParam])
```

Add `<DateRangeFilter>` inside the `filters` JSX, right after the "Utenti associati" block added in Task 2:

```typescript
      <DateRangeFilter
        startDate={startDate} endDate={endDate}
        onChange={(s, e) => { setStartDate(s); setEndDate(e) }}
      />
```

- [x] **Step 4: Run test to verify it passes**

Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py::test_filter_by_creation_date_range -v`
Expected: PASS.

- [x] **Step 5: Full verification pass**

Run (from `sources/microservices/web-construct/`): `npx tsc --noEmit && npm run lint && npx vitest run`
Run (from the repo root): `uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: 0 type/lint errors; all unit tests pass; all `test_roles.py` E2E tests pass.

- [x] **Step 6: Manual browser verification**

Start the dev server if not already running (`npm run dev` from `sources/microservices/web-construct/`), log in, go to `/roles-permissions`, open "Filtri", and confirm: setting Utenti associati min/max narrows the rows; picking a creation-date range via the calendar popovers narrows the rows; combining both filters with "Ha permessi" and the search box all work together; clearing any filter restores the previous rows.

- [x] **Step 7: Mark R-03 done in the spec**

In `docs/input-specs/rbac-fixes-and-improvements/rbac-improvements.md`, change:

```
- R-03 - [ ] Filtri
  - R-03.01 - [ ] Date specificando in un widget calendario le date iniziali e finali
  - R-03.02 - [ ] Numero di ruoli da min a max
```

to:

```
- R-03 - [✅] Filtri
  - R-03.01 - [✅] Date specificando in un widget calendario le date iniziali e finali
  - R-03.02 - [✅] Numero di ruoli da min a max
```

- [x] **Step 8: Commit**

```bash
git add components/rbac/roles/RolesTableClient.tsx ../../tests/e2e/test_roles.py
git add ../../docs/input-specs/rbac-fixes-and-improvements/rbac-improvements.md
git commit -m "feat(rbac): wire date-range filter into Roles list, close R-03"
```
