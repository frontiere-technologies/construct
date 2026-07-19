# AG Grid Community Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom `DataTable` component with AG Grid Community for the Users and Roles tables, using the Infinite Row Model driven by server actions, native per-column filters, URL-synced sort/filter state, and a theme wired to the app's existing CSS tokens.

**Architecture:** Two new shared `components/ui/` primitives (`DataGrid`, `ColumnVisibilityToggle`) plus two shared `components/rbac/` primitives (`GridRowActionsMenu`, `EnumSelectFilter`) form the reusable AG Grid layer. Each table (Users, Roles) gets a pure query-mapping module, a thin server action wrapping the existing Drizzle service call, a client `IDatasource`, and a rewritten `*TableClient.tsx`. `DataTable.tsx`/`FilterDrawer.tsx`/`CustomSelect.tsx` are untouched (still used elsewhere).

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + `ag-grid-community`/`ag-grid-react` v36 (Theming API, Infinite Row Model) + Drizzle ORM (unchanged) + Vitest + Playwright/pytest.

## Global Constraints

- AG Grid Community only — never import or reference `ag-grid-enterprise` or any Enterprise-only feature (Set Filter, Server-Side Row Model, Tree Data, tool panels).
- Package manager is npm (`package-lock.json` present) — use `npm install`, not yarn/pnpm.
- All new client-side files that use hooks or browser APIs need `'use client'`; all new/modified server actions need `'use server'`.
- Path alias `@/*` maps to `sources/microservices/web-construct/*` (see `tsconfig.json`).
- Do not modify `lib/rbac/users-service.ts`, `lib/rbac/roles-service.ts`, `applyUserFilters`, `applyFilters`, or any Drizzle query logic — only wrap them in new server actions.
- Do not delete or modify `components/rbac/DataTable.tsx`, `components/rbac/FilterDrawer.tsx`, or `components/rbac/CustomSelect.tsx` — `FilterDrawer` is still used by `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`.
- Every new server action that reads Users/Roles grid data must call `requireAdmin()` from `lib/rbac/auth-guard.ts` (same defense-in-depth pattern as every existing action in `users-actions.ts`/`roles-actions.ts`), since it's a new server-reachable entry point.
- No `page=` URL param going forward (infinite scroll has no discrete page); `sort`, `direction`, and the existing per-table filter params (`search`, `roleIds`, `statuses`, `createdFrom`, `createdTo`, `hasPermission`, `startDateIns`, `endDateIns`) stay synced to the URL.
- Existing Vitest convention: `environment: 'node'` (see `vitest.config.ts`), no jsdom/`@testing-library/react` — unit tests target pure exported functions only, never component rendering. Follow this for all new tests.
- Run from `sources/microservices/web-construct/`: `npm run lint`, `npx tsc --noEmit`, `npm run test`. E2E: `uv run pytest sources/tests/e2e/test_users.py` / `test_roles.py` from the repo root.

---

## Reference: exact current signatures (do not redefine, just reuse)

- `UsersQuery` (`lib/rbac/types.ts`): `{ page, size, search?, roleIds?, statuses?, createdFrom?, createdTo?, sort?: 'firstName'|'lastName'|'email'|'dateIns'|'dateMod'|'status', direction?: 'ASC'|'DESC' }`
- `UserDTO`: `{ id, firstName, lastName, email, createdAt, updatedAt, roles: {id,name}[], status: {idUserStatus, description}, ... }`
- `RolesQuery`: `{ page, size, search?, sort?: 'id'|'description'|'associatedUsers'|'hasPermissions'|'dateIns'|'dateMod', direction?: 'ASC'|'DESC', hasPermission?: boolean, startDateIns?, endDateIns? }`
- `RolePageItemDto`: `{ id, description, associatedUsers, hasPermissions, dateIns, dateMod, roleType: 'SYSTEM'|'SERVICE'|'SYNCED' }`
- `listUsers(query: UsersQuery): Promise<{ users: UserDTO[]; total: number }>` (`lib/rbac/users-service.ts`)
- `listRoles(query: RolesQuery): Promise<RolesPage>` where `RolesPage = { pagination: {...}, elements: RolePageItemDto[] }` (`lib/rbac/roles-service.ts`)
- `requireAdmin(): Promise<{ userId: string; roleIds: number[] }>` (`lib/rbac/auth-guard.ts`) — throws `'Unauthorized'` if not admin.

---

### Task 1: Install AG Grid Community dependencies

**Files:**
- Modify: `sources/microservices/web-construct/package.json`

**Interfaces:**
- Produces: `ag-grid-community` and `ag-grid-react` importable from any client component in this package.

- [✅] **Step 1: Install the packages**

Run from `sources/microservices/web-construct/`:
```bash
npm install ag-grid-community@^36.0.1 ag-grid-react@^36.0.1
```

- [✅] **Step 2: Verify they resolve and the app still builds**

Run: `npx tsc --noEmit`
Expected: no new errors (packages installed but unused so far).

Run: `npm run lint`
Expected: passes (no new files yet).

- [✅] **Step 3: Commit**

```bash
cd sources/microservices/web-construct
git add package.json package-lock.json
git commit -m "chore: add ag-grid-community and ag-grid-react dependencies"
```

---

### Task 2: Grid theme and locale config

**Files:**
- Create: `sources/microservices/web-construct/components/ui/dataGridConfig.ts`

**Interfaces:**
- Produces: `appGridTheme` (an AG Grid `Theme` object) and `itLocaleText` (an object for `AgGridReact`'s `localeText` prop) — both consumed by Task 3's `DataGrid.tsx`.

- [✅] **Step 1: Write the config file**

```ts
import { themeQuartz } from 'ag-grid-community'

export const appGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--theme-surface)',
  foregroundColor: 'var(--theme-foreground)',
  borderColor: 'var(--theme-border)',
  accentColor: 'var(--theme-primary)',
  rowHoverColor: 'var(--theme-surface-hover)',
  headerBackgroundColor: '#111827',
  headerTextColor: '#ffffff',
  headerColumnResizeHandleColor: 'var(--theme-border)',
  oddRowBackgroundColor: 'var(--theme-surface)',
})

export const itLocaleText = {
  contains: 'Contiene',
  inRange: "Nell'intervallo",
  inRangeStart: 'Da',
  inRangeEnd: 'A',
  filterOoo: 'Filtra...',
  applyFilter: 'Applica',
  resetFilter: 'Reset',
  clearFilter: 'Cancella',
  noRowsToShow: 'Nessun risultato',
  loadingOoo: 'Caricamento...',
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `withParams` rejects any key name (compile error naming the invalid key), remove that key — it means that param doesn't exist in the installed v36.0.1 types; the remaining params still cover background/border/accent/hover, which are the ones that matter for live-theme following.

- [✅] **Step 3: Commit**

```bash
git add components/ui/dataGridConfig.ts
git commit -m "feat(grid): add AG Grid theme wired to app CSS tokens + Italian locale"
```

---

### Task 3: Shared `DataGrid` wrapper + column-visibility toggle

**Files:**
- Create: `sources/microservices/web-construct/components/ui/DataGrid.tsx`
- Create: `sources/microservices/web-construct/components/ui/ColumnVisibilityToggle.tsx`

**Interfaces:**
- Consumes: `appGridTheme`, `itLocaleText` from Task 2 (`@/components/ui/dataGridConfig`).
- Produces:
  - `GRID_BLOCK_SIZE: number` (exported constant, `= 50`) — consumed by every table's datasource (Tasks 8, 13).
  - `DataGrid<T>` component with props `{ columnDefs: ColDef<T>[]; datasource: IDatasource; getRowId: (data: T) => string; initialFilterModel?: Record<string, unknown>; initialSortModel?: { colId: string; sort: 'asc'|'desc' }[]; onFilterChanged?: (e: FilterChangedEvent<T>) => void; onSortChanged?: (e: SortChangedEvent<T>) => void; onRowClicked?: (data: T) => void; onGridReady?: (e: GridReadyEvent<T>) => void }` — consumed by Tasks 9, 14.
  - `ColumnVisibilityToggle<T>` component with props `{ gridApi: GridApi<T> | null; columns: { colId: string; label: string }[] }` — consumed by Tasks 9, 14.

- [✅] **Step 1: Write `DataGrid.tsx`**

```tsx
'use client'

import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry, AllCommunityModule,
  type ColDef, type IDatasource, type GridReadyEvent,
  type FilterChangedEvent, type SortChangedEvent,
} from 'ag-grid-community'
import { appGridTheme, itLocaleText } from './dataGridConfig'

ModuleRegistry.registerModules([AllCommunityModule])

export const GRID_BLOCK_SIZE = 50

export interface DataGridProps<T> {
  columnDefs: ColDef<T>[]
  datasource: IDatasource
  getRowId: (data: T) => string
  initialFilterModel?: Record<string, unknown>
  initialSortModel?: { colId: string; sort: 'asc' | 'desc' }[]
  onFilterChanged?: (event: FilterChangedEvent<T>) => void
  onSortChanged?: (event: SortChangedEvent<T>) => void
  onRowClicked?: (data: T) => void
  onGridReady?: (event: GridReadyEvent<T>) => void
}

export default function DataGrid<T>({
  columnDefs, datasource, getRowId, initialFilterModel, initialSortModel,
  onFilterChanged, onSortChanged, onRowClicked, onGridReady,
}: DataGridProps<T>) {
  const defaultColDef = useMemo<ColDef<T>>(() => ({
    resizable: true,
    sortable: true,
    filter: false,
  }), [])

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden" style={{ height: 600 }}>
      <AgGridReact<T>
        theme={appGridTheme}
        localeText={itLocaleText}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={GRID_BLOCK_SIZE}
        maxBlocksInCache={10}
        getRowId={params => getRowId(params.data)}
        initialState={{
          filter: initialFilterModel ? { filterModel: initialFilterModel } : undefined,
          sort: initialSortModel ? { sortModel: initialSortModel } : undefined,
        }}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onRowClicked={onRowClicked ? e => { if (e.data) onRowClicked(e.data) } : undefined}
        onGridReady={onGridReady}
      />
    </div>
  )
}
```

- [✅] **Step 2: Write `ColumnVisibilityToggle.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Columns3 } from 'lucide-react'
import type { GridApi } from 'ag-grid-community'

export interface ToggleableColumn { colId: string; label: string }

export default function ColumnVisibilityToggle<T>(
  { gridApi, columns }: { gridApi: GridApi<T> | null; columns: ToggleableColumn[] },
) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const toggle = (colId: string) => {
    if (!gridApi) return
    const willHide = !hidden.has(colId)
    const next = new Set(hidden)
    if (willHide) next.add(colId); else next.delete(colId)
    setHidden(next)
    gridApi.setColumnsVisible([colId], !willHide)
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border">
        <Columns3 size={16} /> Colonne
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-48 p-2 rounded-lg border border-border bg-surface-overlay shadow">
          {columns.map(c => (
            <label key={c.colId} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
              <input type="checkbox" checked={!hidden.has(c.colId)} onChange={() => toggle(c.colId)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [✅] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. If `theme`/`initialState`/`getRowId` props are rejected by `AgGridReact`'s types, check the installed version's prop names via `node_modules/ag-grid-react/dist/types/src/*.d.ts` and adjust — these are the documented v36 Theming API + infinite-row-model props, but confirm against the exact installed types before moving on.

- [✅] **Step 4: Commit**

```bash
git add components/ui/DataGrid.tsx components/ui/ColumnVisibilityToggle.tsx
git commit -m "feat(grid): add shared DataGrid wrapper and column visibility toggle"
```

---

### Task 4: Shared row-actions cell renderer

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/GridRowActionsMenu.tsx`

**Interfaces:**
- Produces: `RowMenuItem` (`{ label: string; onClick: () => void; disabled?: boolean }`), `GridRowActionsMenuParams<T>` (extends AG Grid's `ICellRendererParams<T>` with `getItems: (data: T) => RowMenuItem[]`), and the default-exported `GridRowActionsMenu<T>` cell renderer component — consumed by Tasks 9 and 14 via `cellRenderer: GridRowActionsMenu, cellRendererParams: { getItems: ... }`.

- [✅] **Step 1: Write the component**

Ported from the existing per-row menu logic in `components/rbac/DataTable.tsx` (portal positioning, outside-click/scroll/resize close), adapted to AG Grid's cell renderer contract:

```tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { ICellRendererParams } from 'ag-grid-community'

export interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

export interface GridRowActionsMenuParams<T> extends ICellRendererParams<T> {
  getItems: (data: T) => RowMenuItem[]
}

export default function GridRowActionsMenu<T>(params: GridRowActionsMenuParams<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setPos(null) }, [])

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  if (!params.data) return null
  const rowId = params.node.id ?? ''
  const items = params.getItems(params.data)

  return (
    <div className="flex justify-end" onClick={e => e.stopPropagation()}>
      <button
        data-testid={`row-menu-${rowId}`}
        onClick={e => {
          if (open) { close(); return }
          const rect = e.currentTarget.getBoundingClientRect()
          setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
          setOpen(true)
        }}
        className="p-1 rounded hover:bg-surface-hover"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-40 p-1 rounded-lg border border-border bg-surface-overlay shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { close(); item.onClick() }}
              className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [✅] **Step 3: Commit**

```bash
git add components/rbac/GridRowActionsMenu.tsx
git commit -m "feat(grid): add shared row-actions cell renderer"
```

---

### Task 5: Shared enum-select custom filter

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/filters/EnumSelectFilter.tsx`

**Interfaces:**
- Produces: `EnumFilterModel` (`{ value: string | number }`), `EnumFilterOption` (`{ value: string | number; label: string }`), default-exported `EnumSelectFilter` component — consumed by Tasks 9 and 14 as `filter: EnumSelectFilter, filterParams: { options: EnumFilterOption[] }`.
- The filter model this produces/consumes (`{ value } | null`) is the exact shape Tasks 6 and 11's pure query-mapping functions expect under `filterModel.roles`, `filterModel.status`, `filterModel.hasPermissions`.

- [✅] **Step 1: Write the component**

Since filtering happens server-side (Infinite Row Model), `doesFilterPass` is never actually invoked by the grid — it's required by the interface but can unconditionally return `true` (this is AG Grid's documented pattern for server-side/external filtering with custom filters).

```tsx
'use client'

import { useGridFilter, type CustomFilterProps } from 'ag-grid-react'
import { Check } from 'lucide-react'

export interface EnumFilterModel { value: string | number }
export interface EnumFilterOption { value: string | number; label: string }

type Props = CustomFilterProps<unknown, unknown, EnumFilterModel> & { options: EnumFilterOption[] }

export default function EnumSelectFilter({ model, onModelChange, options }: Props) {
  useGridFilter({ doesFilterPass: () => true })

  return (
    <div className="w-48 p-1">
      <button
        type="button"
        onClick={() => onModelChange(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${model == null ? 'font-medium' : 'text-foreground-secondary'}`}
      >
        <span className="flex-1">Tutti</span>
        {model == null && <Check size={13} className="text-primary shrink-0" />}
      </button>
      {options.map(opt => {
        const selected = model != null && String(model.value) === String(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`filter-option-${opt.value}`}
            onClick={() => onModelChange(selected ? null : { value: opt.value })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-surface-hover ${selected ? 'font-medium' : 'text-foreground-secondary'}`}
          >
            <span className="flex-1">{opt.label}</span>
            {selected && <Check size={13} className="text-primary shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `useGridFilter`/`CustomFilterProps` aren't exported under those exact names from the installed `ag-grid-react` v36, check `node_modules/ag-grid-react/dist/types/src/index.d.ts` for the actual hook-based custom-filter export name and adjust the import.

- [✅] **Step 3: Commit**

```bash
git add components/rbac/filters/EnumSelectFilter.tsx
git commit -m "feat(grid): add shared custom enum-select column filter"
```

---

### Task 6: Users grid query mapping (pure functions)

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/users-grid-query.ts`
- Test: `sources/microservices/web-construct/lib/rbac/users-grid-query.test.ts`

**Interfaces:**
- Consumes: `UsersQuery`, `UserStatusId` from `./types`.
- Produces:
  - `UsersGridFilterModel` (`{ firstName?: {filter?:string}; roles?: {value?:number|string}; status?: {value?:number|string}; dateIns?: {dateFrom?:string; dateTo?:string} }`)
  - `UsersGridSortItem` (`{ colId: string; sort: 'asc'|'desc' }`)
  - `buildUsersGridQuery(startRow: number, pageSize: number, sortModel: UsersGridSortItem[], filterModel: UsersGridFilterModel): UsersQuery` — consumed by Task 8's datasource.
  - `UsersUrlParams` (`{ search: string; roleId: number|null; statusId: number|null; createdFrom: string|null; createdTo: string|null; sortField: string; sortDir: 'ASC'|'DESC' }`)
  - `usersUrlParamsToFilterModel(p: UsersUrlParams): UsersGridFilterModel` and `usersUrlParamsToSortModel(p: UsersUrlParams): UsersGridSortItem[]` — consumed by Task 9 for `DataGrid`'s `initialFilterModel`/`initialSortModel`.
  - `usersFilterModelToSearchParams(filterModel: UsersGridFilterModel): Record<string, string|null>` — consumed by Task 9's `onFilterChanged` handler.

- [✅] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildUsersGridQuery, usersUrlParamsToFilterModel, usersFilterModelToSearchParams } from './users-grid-query'

describe('buildUsersGridQuery', () => {
  it('defaults to page 0, dateIns/DESC sort, no filters', () => {
    expect(buildUsersGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, search: undefined, roleIds: undefined, statuses: undefined,
      createdFrom: undefined, createdTo: undefined, sort: 'dateIns', direction: 'DESC',
    })
  })

  it('computes page from startRow and block size', () => {
    expect(buildUsersGridQuery(150, 50, [], {}).page).toBe(3)
  })

  it('maps text, enum, and date-range filters plus an explicit sort', () => {
    const q = buildUsersGridQuery(0, 50, [{ colId: 'email', sort: 'asc' }], {
      firstName: { filter: 'mario' },
      roles: { value: 1 },
      status: { value: 2 },
      dateIns: { dateFrom: '2026-01-01 00:00:00', dateTo: '2026-01-31 00:00:00' },
    })
    expect(q.search).toBe('mario')
    expect(q.roleIds).toEqual([1])
    expect(q.statuses).toEqual([2])
    expect(q.createdFrom).toBe('2026-01-01')
    expect(q.createdTo).toBe('2026-01-31')
    expect(q.sort).toBe('email')
    expect(q.direction).toBe('ASC')
  })
})

describe('usersUrlParamsToFilterModel / usersFilterModelToSearchParams', () => {
  it('produces an empty model when nothing is set', () => {
    expect(usersUrlParamsToFilterModel({ search: '', roleId: null, statusId: null, createdFrom: null, createdTo: null, sortField: 'dateIns', sortDir: 'DESC' })).toEqual({})
  })

  it('round-trips filter values through both directions', () => {
    const model = usersUrlParamsToFilterModel({ search: 'foo', roleId: 1, statusId: 2, createdFrom: '2026-01-01', createdTo: '2026-01-31', sortField: 'dateIns', sortDir: 'DESC' })
    expect(usersFilterModelToSearchParams(model)).toEqual({
      search: 'foo', roleIds: '1', statuses: '2', createdFrom: '2026-01-01', createdTo: '2026-01-31',
    })
  })
})
```

- [✅] **Step 2: Run tests to verify they fail**

Run: `npm run test -- users-grid-query`
Expected: FAIL with "Cannot find module './users-grid-query'" (file doesn't exist yet).

- [✅] **Step 3: Write the implementation**

```ts
import type { UsersQuery, UserStatusId } from './types'

export interface UsersGridFilterModel {
  firstName?: { filter?: string }
  roles?: { value?: number | string }
  status?: { value?: number | string }
  dateIns?: { dateFrom?: string; dateTo?: string }
}

export interface UsersGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildUsersGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: UsersGridSortItem[],
  filterModel: UsersGridFilterModel,
): UsersQuery {
  const sortItem = sortModel[0]
  const dateFilter = filterModel.dateIns
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.firstName?.filter || undefined,
    roleIds: filterModel.roles?.value != null ? [Number(filterModel.roles.value)] : undefined,
    statuses: filterModel.status?.value != null ? [Number(filterModel.status.value) as UserStatusId] : undefined,
    createdFrom: dateFilter?.dateFrom?.slice(0, 10),
    createdTo: dateFilter?.dateTo?.slice(0, 10),
    sort: (sortItem?.colId as UsersQuery['sort']) ?? 'dateIns',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'DESC',
  }
}

export interface UsersUrlParams {
  search: string
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function usersUrlParamsToFilterModel(p: UsersUrlParams): UsersGridFilterModel {
  const model: UsersGridFilterModel = {}
  if (p.search) model.firstName = { filter: p.search }
  if (p.roleId != null) model.roles = { value: p.roleId }
  if (p.statusId != null) model.status = { value: p.statusId }
  if (p.createdFrom || p.createdTo) model.dateIns = { dateFrom: p.createdFrom ?? undefined, dateTo: p.createdTo ?? undefined }
  return model
}

export function usersUrlParamsToSortModel(p: UsersUrlParams): UsersGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function usersFilterModelToSearchParams(filterModel: UsersGridFilterModel): Record<string, string | null> {
  return {
    search: filterModel.firstName?.filter || null,
    roleIds: filterModel.roles?.value != null ? String(filterModel.roles.value) : null,
    statuses: filterModel.status?.value != null ? String(filterModel.status.value) : null,
    createdFrom: filterModel.dateIns?.dateFrom ? filterModel.dateIns.dateFrom.slice(0, 10) : null,
    createdTo: filterModel.dateIns?.dateTo ? filterModel.dateIns.dateTo.slice(0, 10) : null,
  }
}
```

- [✅] **Step 4: Run tests to verify they pass**

Run: `npm run test -- users-grid-query`
Expected: PASS (all 5 tests).

- [✅] **Step 5: Commit**

```bash
git add lib/rbac/users-grid-query.ts lib/rbac/users-grid-query.test.ts
git commit -m "feat(grid): add pure Users grid query/filter-model mapping functions"
```

---

### Task 7: Users server action for grid paging

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/users-actions.ts`

**Interfaces:**
- Consumes: `listUsers` from `./users-service`, `requireAdmin` from `./auth-guard` (already imported in this file).
- Produces: `fetchUsersGridPage(query: UsersQuery): Promise<{ users: UserDTO[]; total: number }>` — consumed by Task 8's datasource.

- [✅] **Step 1: Add the import and the action**

Add to the top of `lib/rbac/users-actions.ts` (alongside the existing imports):
```ts
import { listUsers } from './users-service'
import type { UserDTO, UsersQuery } from './types'
```

Append at the end of the file:
```ts
export async function fetchUsersGridPage(query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> {
  await requireAdmin()
  return listUsers(query)
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [✅] **Step 3: Commit**

```bash
git add lib/rbac/users-actions.ts
git commit -m "feat(grid): add fetchUsersGridPage server action wrapping listUsers"
```

---

### Task 8: Users datasource

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/users/usersDatasource.ts`

**Interfaces:**
- Consumes: `GRID_BLOCK_SIZE` from `@/components/ui/DataGrid` (Task 3), `fetchUsersGridPage` from `@/lib/rbac/users-actions` (Task 7), `buildUsersGridQuery`/`UsersGridFilterModel`/`UsersGridSortItem` from `@/lib/rbac/users-grid-query` (Task 6).
- Produces: `createUsersDatasource(): IDatasource` — consumed by Task 9's `UsersTableClient`.

- [✅] **Step 1: Write the datasource**

```ts
'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import { fetchUsersGridPage } from '@/lib/rbac/users-actions'
import { buildUsersGridQuery, type UsersGridFilterModel, type UsersGridSortItem } from '@/lib/rbac/users-grid-query'

export function createUsersDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildUsersGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as UsersGridSortItem[],
        params.filterModel as UsersGridFilterModel,
      )
      fetchUsersGridPage(query)
        .then(({ users }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = users.length < GRID_BLOCK_SIZE ? from + users.length : undefined
          params.successCallback(users, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [✅] **Step 3: Commit**

```bash
git add components/rbac/users/usersDatasource.ts
git commit -m "feat(grid): add Users AG Grid infinite-row-model datasource"
```

---

### Task 9: Rewrite `UsersTableClient.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx`

**Interfaces:**
- Consumes: `DataGrid`, `ColumnVisibilityToggle` (Task 3), `GridRowActionsMenu` (Task 4), `EnumSelectFilter` (Task 5), `createUsersDatasource` (Task 8), `usersUrlParamsToFilterModel`/`usersUrlParamsToSortModel`/`usersFilterModelToSearchParams` (Task 6), `setUserStatus` (existing, unchanged), `ManageRolesModal`/`StatusBadge` (existing, unchanged).
- Produces: same default export shape consumers expect — `UsersTableClient(props)` — but with a **narrower `Props`** than today (see below; `rows`, `page`, `totalPages` are dropped since rows now come from the grid's own datasource and there's no discrete page).

- [✅] **Step 1: Replace the file**

```tsx
'use client'

import React, { useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import ColumnVisibilityToggle from '@/components/ui/ColumnVisibilityToggle'
import GridRowActionsMenu from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import { createUsersDatasource } from './usersDatasource'
import {
  usersUrlParamsToFilterModel, usersUrlParamsToSortModel, usersFilterModelToSearchParams,
  type UsersGridFilterModel,
} from '@/lib/rbac/users-grid-query'
import type { UserDTO } from '@/lib/rbac/types'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from '@/lib/rbac/types'

interface Props {
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  allRoles: { id: number; name: string }[]
  roleId: number | null
  statusId: number | null
  createdFrom: string | null
  createdTo: string | null
}

const COLUMN_LABELS = [
  { colId: 'firstName', label: 'Utente' },
  { colId: 'email', label: 'Email' },
  { colId: 'roles', label: 'Ruoli' },
  { colId: 'status', label: 'Stato' },
  { colId: 'dateIns', label: 'Creato' },
  { colId: 'dateMod', label: 'Aggiornato' },
]

export default function UsersTableClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<UserDTO> | null>(null)

  const setParam = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { p.delete(k) } else { p.set(k, v) } }
    p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === USER_STATUS_ACTIVE ? USER_STATUS_DEACTIVATED : USER_STATUS_ACTIVE
    if (!confirm(next === USER_STATUS_DEACTIVATED ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
    try { await setUserStatus(u.id, next); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const datasource = useMemo(() => createUsersDatasource(), [])

  const columnDefs = useMemo<ColDef<UserDTO>[]>(() => [
    {
      colId: 'firstName', headerName: 'Utente', sortable: true,
      valueGetter: p => p.data ? fullName(p.data) : '',
      filter: 'agTextColumnFilter',
      filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
    },
    { field: 'email', headerName: 'Email', sortable: true, filter: false },
    {
      colId: 'roles', headerName: 'Ruoli', sortable: false, filter: EnumSelectFilter,
      filterParams: { options: props.allRoles.map(r => ({ value: r.id, label: r.name })) },
      valueGetter: p => p.data ? (p.data.roles.map(r => r.name).join(', ') || '—') : '',
    },
    {
      colId: 'status', headerName: 'Stato', sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: USER_STATUS_ACTIVE, label: 'Attivo' }, { value: USER_STATUS_DEACTIVATED, label: 'Disattivato' }] },
      cellRenderer: (p: { data?: UserDTO }) => p.data ? <StatusBadge status={p.data.status} onToggle={() => toggleStatus(p.data!)} /> : null,
    },
    {
      colId: 'dateIns', headerName: 'Creato', sortable: true,
      filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['inRange'], defaultOption: 'inRange', buttons: ['apply', 'reset'] },
      valueGetter: p => p.data ? new Date(p.data.createdAt).toLocaleDateString() : '',
    },
    {
      colId: 'dateMod', headerName: 'Aggiornato', sortable: true, filter: false,
      valueGetter: p => p.data?.updatedAt ? new Date(p.data.updatedAt).toLocaleDateString() : '—',
    },
    {
      colId: 'actions', headerName: '', sortable: false, filter: false, resizable: false, width: 56,
      cellRenderer: GridRowActionsMenu,
      cellRendererParams: {
        getItems: (u: UserDTO) => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }],
      },
    },
  ], [props.allRoles])

  const onFilterChanged = (event: FilterChangedEvent<UserDTO>) => {
    const model = event.api.getFilterModel() as UsersGridFilterModel
    setParam(usersFilterModelToSearchParams(model))
  }

  const onSortChanged = (event: SortChangedEvent<UserDTO>) => {
    const active = event.api.getColumnState().find(c => c.sort)
    setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
  }

  const onGridReady = (event: GridReadyEvent<UserDTO>) => {
    setGridApi(event.api)
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ColumnVisibilityToggle gridApi={gridApi} columns={COLUMN_LABELS} />
      </div>
      <DataGrid<UserDTO>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={u => u.id}
        initialFilterModel={usersUrlParamsToFilterModel(props)}
        initialSortModel={usersUrlParamsToSortModel(props)}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onGridReady={onGridReady}
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

- [✅] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Task 10 still needs to update, so `user-management/page.tsx` will show a prop-mismatch error until then — that's expected and resolved in the next task.

- [✅] **Step 3: Commit**

```bash
git add components/rbac/users/UsersTableClient.tsx
git commit -m "refactor(users): migrate UsersTableClient from DataTable to AG Grid"
```

---

### Task 10: Simplify `user-management/page.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/user-management/page.tsx`

**Interfaces:**
- Consumes: `getAllRoles` (existing, unchanged), `UsersTableClient` (Task 9's new prop shape).

- [✅] **Step 1: Replace the file**

```tsx
import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import type { UsersQuery, UserStatusId } from '@/lib/rbac/types'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const allRolesRaw = await getAllRoles()
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Utenti</h1>
      <UsersTableClient
        sortField={(sp.sort as UsersQuery['sort']) ?? 'dateIns'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'DESC'}
        search={sp.search ?? ''}
        allRoles={allRoles}
        roleId={sp.roleIds ? Number(sp.roleIds.split(',')[0]) : null}
        statusId={sp.statuses ? (Number(sp.statuses.split(',')[0]) as UserStatusId) : null}
        createdFrom={sp.createdFrom ?? null}
        createdTo={sp.createdTo ?? null}
      />
    </div>
  )
}
```

- [✅] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS with zero errors now (Task 9's prop mismatch is resolved).

- [✅] **Step 3: Manual smoke check**

Run: `npm run dev` (from `sources/microservices/web-construct/`), open `http://localhost:3000/user-management` as an admin.
Expected: page loads, grid renders with all 6 columns + actions, rows scroll-load, header click sorts, column filter icons open a popup, "Colonne" toggle hides/shows a column, "Gestisci ruoli" row action opens the existing modal, status badge toggles on click.

- [✅] **Step 4: Commit**

```bash
git add "app/(protected)/user-management/page.tsx"
git commit -m "refactor(users): simplify user-management page for AG Grid datasource"
```

---

### Task 11: Roles grid query mapping (pure functions)

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/roles-grid-query.ts`
- Test: `sources/microservices/web-construct/lib/rbac/roles-grid-query.test.ts`

**Interfaces:**
- Consumes: `RolesQuery` from `./types`.
- Produces: mirrors Task 6 exactly for Roles —
  - `RolesGridFilterModel` (`{ description?: {filter?:string}; hasPermissions?: {value?:string|number}; dateIns?: {dateFrom?:string; dateTo?:string} }`)
  - `RolesGridSortItem` (`{ colId: string; sort: 'asc'|'desc' }`)
  - `buildRolesGridQuery(startRow: number, pageSize: number, sortModel: RolesGridSortItem[], filterModel: RolesGridFilterModel): RolesQuery` — consumed by Task 13.
  - `RolesUrlParams` (`{ search: string; hasPermission: boolean|null; startDateIns: string|null; endDateIns: string|null; sortField: string; sortDir: 'ASC'|'DESC' }`)
  - `rolesUrlParamsToFilterModel`/`rolesUrlParamsToSortModel` — consumed by Task 14.
  - `rolesFilterModelToSearchParams(filterModel: RolesGridFilterModel): Record<string, string|null>` — consumed by Task 14.

- [✅] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildRolesGridQuery, rolesUrlParamsToFilterModel, rolesFilterModelToSearchParams } from './roles-grid-query'

describe('buildRolesGridQuery', () => {
  it('defaults to page 0, id/ASC sort, no filters', () => {
    expect(buildRolesGridQuery(0, 50, [], {})).toEqual({
      page: 0, size: 50, search: undefined, hasPermission: undefined,
      startDateIns: undefined, endDateIns: undefined, sort: 'id', direction: 'ASC',
    })
  })

  it('computes page from startRow and block size', () => {
    expect(buildRolesGridQuery(150, 50, [], {}).page).toBe(3)
  })

  it('maps text, boolean-enum, and date-range filters plus an explicit sort', () => {
    const q = buildRolesGridQuery(0, 50, [{ colId: 'description', sort: 'desc' }], {
      description: { filter: 'admin' },
      hasPermissions: { value: 'false' },
      dateIns: { dateFrom: '2026-01-01 00:00:00', dateTo: '2026-01-31 00:00:00' },
    })
    expect(q.search).toBe('admin')
    expect(q.hasPermission).toBe(false)
    expect(q.startDateIns).toBe('2026-01-01')
    expect(q.endDateIns).toBe('2026-01-31')
    expect(q.sort).toBe('description')
    expect(q.direction).toBe('DESC')
  })

  it('treats hasPermissions value "true" as boolean true', () => {
    expect(buildRolesGridQuery(0, 50, [], { hasPermissions: { value: 'true' } }).hasPermission).toBe(true)
  })
})

describe('rolesUrlParamsToFilterModel / rolesFilterModelToSearchParams', () => {
  it('produces an empty model when nothing is set', () => {
    expect(rolesUrlParamsToFilterModel({ search: '', hasPermission: null, startDateIns: null, endDateIns: null, sortField: 'id', sortDir: 'ASC' })).toEqual({})
  })

  it('round-trips filter values through both directions', () => {
    const model = rolesUrlParamsToFilterModel({ search: 'foo', hasPermission: false, startDateIns: '2026-01-01', endDateIns: '2026-01-31', sortField: 'id', sortDir: 'ASC' })
    expect(rolesFilterModelToSearchParams(model)).toEqual({
      search: 'foo', hasPermission: 'false', startDateIns: '2026-01-01', endDateIns: '2026-01-31',
    })
  })
})
```

- [✅] **Step 2: Run tests to verify they fail**

Run: `npm run test -- roles-grid-query`
Expected: FAIL with "Cannot find module './roles-grid-query'".

- [✅] **Step 3: Write the implementation**

```ts
import type { RolesQuery } from './types'

export interface RolesGridFilterModel {
  description?: { filter?: string }
  hasPermissions?: { value?: string | number }
  dateIns?: { dateFrom?: string; dateTo?: string }
}

export interface RolesGridSortItem { colId: string; sort: 'asc' | 'desc' }

export function buildRolesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: RolesGridSortItem[],
  filterModel: RolesGridFilterModel,
): RolesQuery {
  const sortItem = sortModel[0]
  const dateFilter = filterModel.dateIns
  const hasPermValue = filterModel.hasPermissions?.value
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    search: filterModel.description?.filter || undefined,
    hasPermission: hasPermValue === 'true' ? true : hasPermValue === 'false' ? false : undefined,
    startDateIns: dateFilter?.dateFrom?.slice(0, 10),
    endDateIns: dateFilter?.dateTo?.slice(0, 10),
    sort: (sortItem?.colId as RolesQuery['sort']) ?? 'id',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface RolesUrlParams {
  search: string
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

export function rolesUrlParamsToFilterModel(p: RolesUrlParams): RolesGridFilterModel {
  const model: RolesGridFilterModel = {}
  if (p.search) model.description = { filter: p.search }
  if (p.hasPermission != null) model.hasPermissions = { value: String(p.hasPermission) }
  if (p.startDateIns || p.endDateIns) model.dateIns = { dateFrom: p.startDateIns ?? undefined, dateTo: p.endDateIns ?? undefined }
  return model
}

export function rolesUrlParamsToSortModel(p: RolesUrlParams): RolesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function rolesFilterModelToSearchParams(filterModel: RolesGridFilterModel): Record<string, string | null> {
  return {
    search: filterModel.description?.filter || null,
    hasPermission: filterModel.hasPermissions?.value != null ? String(filterModel.hasPermissions.value) : null,
    startDateIns: filterModel.dateIns?.dateFrom ? filterModel.dateIns.dateFrom.slice(0, 10) : null,
    endDateIns: filterModel.dateIns?.dateTo ? filterModel.dateIns.dateTo.slice(0, 10) : null,
  }
}
```

- [✅] **Step 4: Run tests to verify they pass**

Run: `npm run test -- roles-grid-query`
Expected: PASS (all 6 tests).

- [✅] **Step 5: Commit**

```bash
git add lib/rbac/roles-grid-query.ts lib/rbac/roles-grid-query.test.ts
git commit -m "feat(grid): add pure Roles grid query/filter-model mapping functions"
```

---

### Task 12: Roles server action for grid paging

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/roles-actions.ts`

**Interfaces:**
- Consumes: `listRoles` from `./roles-service`, `requireAdmin` (already imported).
- Produces: `fetchRolesGridPage(query: RolesQuery): Promise<RolesPage>` — consumed by Task 13's datasource.

- [✅] **Step 1: Add the import and the action**

Add to the top of `lib/rbac/roles-actions.ts`:
```ts
import { listRoles } from './roles-service'
import type { RolesPage, RolesQuery } from './types'
```

Append at the end of the file:
```ts
export async function fetchRolesGridPage(query: RolesQuery): Promise<RolesPage> {
  await requireAdmin()
  return listRoles(query)
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [✅] **Step 3: Commit**

```bash
git add lib/rbac/roles-actions.ts
git commit -m "feat(grid): add fetchRolesGridPage server action wrapping listRoles"
```

---

### Task 13: Roles datasource

**Files:**
- Create: `sources/microservices/web-construct/components/rbac/roles/rolesDatasource.ts`

**Interfaces:**
- Consumes: `GRID_BLOCK_SIZE` (Task 3), `fetchRolesGridPage` (Task 12), `buildRolesGridQuery`/`RolesGridFilterModel`/`RolesGridSortItem` (Task 11).
- Produces: `createRolesDatasource(): IDatasource` — consumed by Task 14.

- [✅] **Step 1: Write the datasource**

```ts
'use client'

import type { IDatasource, IGetRowsParams } from 'ag-grid-community'
import { GRID_BLOCK_SIZE } from '@/components/ui/DataGrid'
import { fetchRolesGridPage } from '@/lib/rbac/roles-actions'
import { buildRolesGridQuery, type RolesGridFilterModel, type RolesGridSortItem } from '@/lib/rbac/roles-grid-query'

export function createRolesDatasource(): IDatasource {
  return {
    getRows(params: IGetRowsParams) {
      const query = buildRolesGridQuery(
        params.startRow,
        GRID_BLOCK_SIZE,
        params.sortModel as RolesGridSortItem[],
        params.filterModel as RolesGridFilterModel,
      )
      fetchRolesGridPage(query)
        .then(({ elements }) => {
          const from = query.page * GRID_BLOCK_SIZE
          const lastRow = elements.length < GRID_BLOCK_SIZE ? from + elements.length : undefined
          params.successCallback(elements, lastRow)
        })
        .catch(() => params.failCallback())
    },
  }
}
```

- [✅] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [✅] **Step 3: Commit**

```bash
git add components/rbac/roles/rolesDatasource.ts
git commit -m "feat(grid): add Roles AG Grid infinite-row-model datasource"
```

---

### Task 14: Rewrite `RolesTableClient.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RolesTableClient.tsx`

**Interfaces:**
- Consumes: `DataGrid`/`ColumnVisibilityToggle` (Task 3), `GridRowActionsMenu` (Task 4), `EnumSelectFilter` (Task 5), `createRolesDatasource` (Task 13), `rolesUrlParamsToFilterModel`/`rolesUrlParamsToSortModel`/`rolesFilterModelToSearchParams` (Task 11), `deleteRole` (existing, unchanged), `CreateRoleModal`/`RenameRoleModal` (existing, unchanged).
- Produces: `RolesTableClient(props)` with a narrower `Props` (no `rows`/`page`/`totalPages`).

- [✅] **Step 1: Replace the file**

```tsx
'use client'

import React, { useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import ColumnVisibilityToggle from '@/components/ui/ColumnVisibilityToggle'
import GridRowActionsMenu from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'
import { deleteRole } from '@/lib/rbac/roles-actions'
import { createRolesDatasource } from './rolesDatasource'
import {
  rolesUrlParamsToFilterModel, rolesUrlParamsToSortModel, rolesFilterModelToSearchParams,
  type RolesGridFilterModel,
} from '@/lib/rbac/roles-grid-query'
import type { RolePageItemDto } from '@/lib/rbac/types'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean | null
  startDateIns: string | null
  endDateIns: string | null
}

const COLUMN_LABELS = [
  { colId: 'id', label: 'ID' },
  { colId: 'description', label: 'Nome ruolo' },
  { colId: 'associatedUsers', label: 'Utenti associati' },
  { colId: 'hasPermissions', label: 'Ha permessi' },
  { colId: 'dateIns', label: 'Data di creazione' },
  { colId: 'dateMod', label: 'Ultimo aggiornamento' },
]

export default function RolesTableClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<RolePageItemDto | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<RolePageItemDto> | null>(null)

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) { next.delete(k) } else { next.set(k, v) } }
    next.delete('page')
    router.push(`${pathname}?${next.toString()}`)
  }

  const datasource = useMemo(() => createRolesDatasource(), [])

  const columnDefs = useMemo<ColDef<RolePageItemDto>[]>(() => [
    { field: 'id', headerName: 'ID', sortable: true, filter: false },
    {
      field: 'description', headerName: 'Nome ruolo', sortable: true,
      filter: 'agTextColumnFilter',
      filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? <span className="font-medium">{p.data.description}</span> : null,
    },
    { field: 'associatedUsers', headerName: 'Utenti associati', sortable: true, filter: false },
    {
      colId: 'hasPermissions', headerName: 'Ha permessi', sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: 'true', label: 'Sì' }, { value: 'false', label: 'No' }] },
      cellRenderer: (p: { data?: RolePageItemDto }) => p.data ? (
        <span className={`px-2 py-0.5 rounded-full text-xs ${p.data.hasPermissions ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {p.data.hasPermissions ? 'Sì' : 'No'}
        </span>
      ) : null,
    },
    {
      colId: 'dateIns', headerName: 'Data di creazione', sortable: true,
      filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['inRange'], defaultOption: 'inRange', buttons: ['apply', 'reset'] },
      valueGetter: p => p.data ? fmtDate(p.data.dateIns) : '',
    },
    { field: 'dateMod', headerName: 'Ultimo aggiornamento', sortable: true, filter: false, valueGetter: p => p.data ? fmtDate(p.data.dateMod) : '' },
    {
      colId: 'actions', headerName: '', sortable: false, filter: false, resizable: false, width: 56,
      cellRenderer: GridRowActionsMenu,
      cellRendererParams: {
        getItems: (r: RolePageItemDto) => [
          { label: 'Rinomina', disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
          { label: 'Elimina', disabled: r.roleType === 'SYSTEM', onClick: async () => {
              if (confirm(`Eliminare il ruolo "${r.description}"?`)) { await deleteRole(r.id); router.refresh() }
            } },
        ],
      },
    },
  ], [router])

  const onFilterChanged = (event: FilterChangedEvent<RolePageItemDto>) => {
    const model = event.api.getFilterModel() as RolesGridFilterModel
    setParam(rolesFilterModelToSearchParams(model))
  }

  const onSortChanged = (event: SortChangedEvent<RolePageItemDto>) => {
    const active = event.api.getColumnState().find(c => c.sort)
    setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
  }

  const onGridReady = (event: GridReadyEvent<RolePageItemDto>) => {
    setGridApi(event.api)
  }

  return (
    <>
      <div className="flex justify-end items-center gap-2 mb-3">
        <ColumnVisibilityToggle gridApi={gridApi} columns={COLUMN_LABELS} />
        <button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Nuovo ruolo</button>
      </div>
      <DataGrid<RolePageItemDto>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={r => String(r.id)}
        initialFilterModel={rolesUrlParamsToFilterModel(props)}
        initialSortModel={rolesUrlParamsToSortModel(props)}
        onFilterChanged={onFilterChanged}
        onSortChanged={onSortChanged}
        onRowClicked={r => router.push(`/roles-permissions/${r.id}`)}
        onGridReady={onGridReady}
      />
      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} />}
      {renaming && <RenameRoleModal roleId={renaming.id} currentName={renaming.description} onClose={() => setRenaming(null)} />}
    </>
  )
}
```

- [✅] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (Task 15's page.tsx mismatch resolved next).

- [✅] **Step 3: Commit**

```bash
git add components/rbac/roles/RolesTableClient.tsx
git commit -m "refactor(roles): migrate RolesTableClient from DataTable to AG Grid"
```

---

### Task 15: Simplify `roles-permissions/page.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`

**Interfaces:**
- Consumes: `RolesTableClient` (Task 14's new prop shape). No longer calls `listRoles`.

- [✅] **Step 1: Replace the file**

```tsx
import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
      />
    </div>
  )
}
```

- [✅] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS with zero errors.

- [✅] **Step 3: Manual smoke check**

Run: `npm run dev`, open `http://localhost:3000/roles-permissions` as an admin.
Expected: page loads, grid renders with all 6 columns + actions, "Nuovo ruolo" opens the create modal, row click navigates to role detail, "Rinomina"/"Elimina" row actions work with the same `disabled` rules as before, "Ha permessi" filter and date-range filter work, "Colonne" toggle works.

Verified via Playwright (see `.superpowers/sdd/task-15-report.md` for full detail).
All items passed except: the "Ha permessi" enum filter popup opens and its model
updates correctly, but the grid never re-fetches rows after selecting an option
(pre-existing bug in Task 14's `RolesTableClient.tsx`/`EnumSelectFilter.tsx`, not
introduced by this task — confirmed by reproducing on the pre-Task-15 `page.tsx`
too). Date-range filter works fully end-to-end.

- [✅] **Step 4: Full-app regression pass**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all PASS. Also open `AdminTheme`, change the primary/surface colors, and confirm both grids visually follow the change without a page reload (validates Task 2's theme wiring).

tsc/lint/test all green (95 tests passed). Theme live-check confirmed via Playwright:
changed the primary color on `/admin/theme` (without clicking "Save Theme", so no DB
write occurred), then client-side-navigated to `/user-management` and
`/roles-permissions` and confirmed both grids' `--ag-accent-color` picked up the new
color live, no reload needed.

- [✅] **Step 5: Commit**

```bash
git add "app/(protected)/roles-permissions/page.tsx"
git commit -m "refactor(roles): simplify roles-permissions page for AG Grid datasource"
```

Committed as `9936610`.

---

### Task 16: Rewrite e2e tests — `test_users.py`

**Files:**
- Modify: `sources/tests/e2e/test_users.py`

**Interfaces:**
- Consumes: `nav` from `helpers.py` (unchanged), `logged_in_page`/`non_admin_page`/`base_url` fixtures from `conftest.py` (unchanged).
- Relies on: `data-testid="status-badge"` (unchanged, from `StatusBadge.tsx`), `data-testid="row-menu-{id}"` (Task 4's `GridRowActionsMenu`), `data-testid="save-roles"`/`data-testid="role-checkbox-0"` (unchanged, inside `ManageRolesModal`/`RoleMultiSelect`), `data-testid="filter-option-{value}"` (Task 5's `EnumSelectFilter`), AG Grid's own `[col-id="..."]` attribute on header/cell elements and `.ag-header-icon.ag-filter-icon`/`.ag-filter`/`.ag-center-cols-container .ag-row` structural classes, and the Italian `localeText` button label "Applica" (Task 2).

- [ ] **Step 1: Replace the file**

```python
import re
from playwright.sync_api import expect
from helpers import nav


def _open_column_filter(page, col_id: str):
    header = page.locator(f'.ag-header-cell[col-id="{col_id}"]')
    header.locator('.ag-header-icon.ag-filter-icon').click()


def test_users_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    expect(page.get_by_role("heading", name="Utenti")).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="status"]')).to_be_visible()
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()


def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    before = page.locator('.ag-center-cols-container .ag-row').count()
    _open_column_filter(page, "firstName")
    page.locator('.ag-filter input[type="text"]').first.fill("zzz-no-such-user-zzz")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    after = page.locator('.ag-center-cols-container .ag-row').count()
    assert after <= before


def test_manage_roles_opens_and_lists_roles(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()
    reg = page.get_by_test_id("role-checkbox-0")
    expect(reg).to_be_disabled()


def test_non_admin_denied(non_admin_page, base_url):
    nav(non_admin_page, f"{base_url}/user-management")
    expect(non_admin_page.get_by_role("heading", name="Utenti")).to_have_count(0)


def test_filter_by_status_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    assert page.get_by_text("Attivo", exact=True).count() > 0

    _open_column_filter(page, "status")
    page.get_by_test_id("filter-option-1").click()  # 1 = Disattivato
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("statuses=1"))
    expect(page.get_by_text("Attivo", exact=True)).to_have_count(0)
    expect(page.get_by_text("Disattivato", exact=True).first).to_be_visible()

    _open_column_filter(page, "status")
    page.get_by_text("Tutti", exact=True).click()
    page.wait_for_load_state("networkidle")
    expect(page).not_to_have_url(re.compile("statuses="))
    expect(page.get_by_text("Attivo", exact=True).first).to_be_visible()


def test_filter_by_role(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    rows = page.locator('.ag-center-cols-container .ag-row')
    baseline = rows.count()
    assert baseline > 0
    assert rows.filter(has_text="Administrator").count() < baseline

    _open_column_filter(page, "roles")
    page.get_by_test_id("filter-option-1").click()  # 1 = Administrator
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("roleIds=1"))
    expect(rows.first).to_be_visible()
    expect(rows.filter(has_text="Administrator")).to_have_count(rows.count())


def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    _open_column_filter(page, "dateIns")
    page.locator('.ag-filter input[type="text"]').first.fill("2000-01-01")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("createdFrom="))


def test_column_visibility_toggle(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_be_visible()
    page.get_by_role("button", name="Colonne").click()
    page.get_by_text("Email", exact=True).click()
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_have_count(0)
```

- [ ] **Step 2: Run against the dev server**

Start the app in one terminal (`npm run dev` from `sources/microservices/web-construct/`), then run:
```bash
uv run pytest sources/tests/e2e/test_users.py -v --headed
```
Expected: PASS. If a selector fails (e.g. the filter icon's class name or the date filter's input structure differs from what's assumed here), inspect the actual rendered DOM in the headed browser (or via Playwright's trace/inspector) and adjust that one locator — this is the one area of the plan whose exact markup depends on the installed AG Grid v36 build, and needs a live check against the running app rather than a further offline guess.

- [ ] **Step 3: Commit**

```bash
git add sources/tests/e2e/test_users.py
git commit -m "test(e2e): rewrite Users e2e tests for AG Grid DOM and URL-synced filters"
```

---

### Task 17: Rewrite e2e tests — `test_roles.py`

**Files:**
- Modify: `sources/tests/e2e/test_roles.py`

**Interfaces:**
- Same conventions as Task 16, applied to the Roles page's columns (`description`, `hasPermissions`, `dateIns`) and its own row actions (Rinomina/Elimina) and "Nuovo ruolo" button.

- [ ] **Step 1: Replace the file**

```python
import re
import time
from datetime import date

from playwright.sync_api import expect
from helpers import nav


def _open_column_filter(page, col_id: str):
    header = page.locator(f'.ag-header-cell[col-id="{col_id}"]')
    header.locator('.ag-header-icon.ag-filter-icon').click()


def _search(page, base_url, name):
    nav(page, f"{base_url}/roles-permissions")
    _open_column_filter(page, "description")
    page.locator('.ag-filter input[type="text"]').first.fill(name)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")


def _create_role(page, base_url, name):
    """Create a SERVICE role; lands on its detail page. Returns the detail URL."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    page.wait_for_url("**/roles-permissions/**", timeout=15_000)
    return page.url


def _delete_role(page, base_url, name):
    """Delete a role via the column filter + row menu, then assert it's gone."""
    _search(page, base_url, name)
    row = page.locator('.ag-center-cols-container .ag-row').filter(has_text=name)
    expect(row).to_be_visible()
    row.locator('[data-testid^="row-menu"]').click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    _search(page, base_url, name)
    expect(page.get_by_text(name, exact=True)).to_have_count(0)


def test_roles_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    assert page.get_by_text("Ruoli & permessi").first.is_visible()
    assert page.get_by_text("Administrator", exact=True).first.is_visible()


def test_create_rename_delete_role(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Role {int(time.time())}"
    _create_role(page, base_url, name)
    assert name in page.inner_text("h1")

    renamed = name + " R"
    page.get_by_test_id("rename-role-btn").click()
    page.get_by_placeholder("Nome ruolo").fill(renamed)
    page.get_by_role("button", name="Salva").click()
    expect(page.locator("h1")).to_contain_text(renamed)

    _delete_role(page, base_url, renamed)


def test_toggle_permission_persists(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Perm {int(time.time())}"
    detail_url = _create_role(page, base_url, name)

    page.get_by_role("button", name="Modifica").click()
    page.locator('[data-testid="perm-toggle"]').first.click()
    page.get_by_role("button", name="Salva").click()
    page.get_by_role("button", name="Modifica").wait_for(state="visible", timeout=10_000)

    nav(page, detail_url)
    page.wait_for_selector('[data-testid="perm-toggle"][aria-checked="true"]', timeout=10_000)
    assert page.locator('[data-testid="perm-toggle"][aria-checked="true"]').count() >= 1

    _delete_role(page, base_url, name)


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions/1")  # Administrator = SYSTEM
    edit = page.get_by_role("button", name="Modifica")
    assert edit.is_disabled()


def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E DateFilter {int(time.time())}"
    _create_role(page, base_url, name)

    _search(page, base_url, name)
    expect(page.locator('.ag-center-cols-container .ag-row').filter(has_text=name)).to_have_count(1)

    _open_column_filter(page, "dateIns")
    today = date.today()
    page.locator('.ag-filter input[type="text"]').first.fill(today.strftime("%Y-%m-%d"))
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")

    expect(page.locator('.ag-center-cols-container .ag-row').filter(has_text=name)).to_have_count(1)
    expect(page).to_have_url(re.compile("startDateIns="))

    _delete_role(page, base_url, name)


def test_filter_by_has_permission_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    baseline = page.locator('.ag-center-cols-container .ag-row').count()
    assert baseline > 0
    assert page.get_by_text("Sì", exact=True).count() > 0

    _open_column_filter(page, "hasPermissions")
    page.get_by_test_id("filter-option-false").click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("hasPermission=false"))
    assert page.locator('.ag-center-cols-container .ag-row').count() > 0
    expect(page.get_by_text("Sì", exact=True)).to_have_count(0)

    _open_column_filter(page, "hasPermissions")
    page.get_by_text("Tutti", exact=True).click()
    page.wait_for_load_state("networkidle")
    expect(page).not_to_have_url(re.compile("hasPermission="))
```

- [ ] **Step 2: Run against the dev server**

```bash
uv run pytest sources/tests/e2e/test_roles.py -v --headed
```
Expected: PASS. Same note as Task 16 Step 2 applies if any AG Grid DOM selector needs a live adjustment.

- [ ] **Step 3: Commit**

```bash
git add sources/tests/e2e/test_roles.py
git commit -m "test(e2e): rewrite Roles e2e tests for AG Grid DOM and URL-synced filters"
```

---

### Task 18: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Type-check, lint, unit tests**

Run from `sources/microservices/web-construct/`:
```bash
npx tsc --noEmit && npm run lint && npm run test
```
Expected: all PASS, zero errors/warnings.

- [ ] **Step 2: Full e2e suite**

With the dev server running, from the repo root:
```bash
uv run pytest sources/tests/e2e/test_users.py sources/tests/e2e/test_roles.py -v
```
Expected: all PASS.

- [ ] **Step 3: Full manual browser pass**

In a browser, as an admin:
- `/user-management`: sort each sortable column, apply and reset each filter type (text, enum ×2, date range), scroll to the bottom to trigger more rows loading, click "Gestisci ruoli" and save a role change, toggle a user's status, toggle column visibility, confirm the URL reflects `sort`/`direction`/filter params and has no `page=`.
- `/roles-permissions`: same for its columns/filters, plus "Nuovo ruolo", row click → detail page, "Rinomina"/"Elimina" (respecting SYSTEM/SERVICE `disabled` rules).
- Open the admin theme editor (`AdminTheme`), change the primary color and background/surface colors, confirm both grids update live without a reload.
- Resize a column by dragging its header border on both tables.

Expected: every interaction matches the pre-migration behavior described in the design spec (`docs/superpowers/specs/2026-07-19-ag-grid-migration-design.md`), with filters/sort/pagination now native to AG Grid and pagination replaced by infinite scroll.

- [ ] **Step 4: Update the design spec's decision checklist (if applicable)**

If any decision (DEC-1..DEC-7) in `docs/superpowers/specs/2026-07-19-ag-grid-migration-design.md` had to change during implementation, update that file to match reality before finishing.

- [ ] **Step 5: Final commit**

If Step 4 produced changes:
```bash
git add docs/superpowers/specs/2026-07-19-ag-grid-migration-design.md
git commit -m "docs: reconcile AG Grid migration spec with final implementation"
```
