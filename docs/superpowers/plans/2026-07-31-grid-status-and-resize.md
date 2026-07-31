# Grid Status Labels and Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show simple Complete/Missing status labels and make every data column shrinkable to AG Grid's 20 px technical minimum while keeping the actions column fixed.

**Architecture:** Keep translation label selection in a small pure helper and enforce the resizing invariant at the shared `DataGrid` boundary. Translation columns retain their current initial visual widths by converting restrictive `minWidth` declarations into create-only `initialWidth` declarations; the shared normalizer supplies `minWidth: 20` to every non-actions column without resetting user-resized state when definitions refresh.

**Tech Stack:** Next.js 16, React 19, TypeScript, AG Grid Community, Vitest.

## Global Constraints

- Status filter values remain exactly `complete` and `missing`; only visible labels change.
- Use `translation.complete` and `translation.missing` for visible filter labels.
- Column `colId: actions` remains `resizable: false`, pinned and fixed-width.
- Every other column is `resizable: true` with `minWidth: 20`.
- Preserve existing initial widths and all non-sizing column behavior.
- Do not modify the existing unrelated changes in `lib/i18n/translation-actions.integration.test.ts` or `task-3-report.md`.

---

### Task 1: Simplify translation Status filter labels

**Files:**
- Create: `sources/microservices/web-construct/components/i18n/translations/translationStatusFilter.ts`
- Create: `sources/microservices/web-construct/components/i18n/translations/translationStatusFilter.test.ts`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx:92-100`

**Interfaces:**
- Consumes: `TranslateFn` from `@/lib/i18n/types`.
- Produces: `translationStatusFilterOptions(t: TranslateFn): Array<{ value: 'missing' | 'complete'; label: string }>`.

- [✅] **Step 1: Write the failing label test**

```ts
import { describe, expect, it } from 'vitest'
import { translationStatusFilterOptions } from './translationStatusFilter'

describe('translationStatusFilterOptions', () => {
  it('uses the plain Missing and Complete translation keys', () => {
    const requested: string[] = []
    const options = translationStatusFilterOptions(((key: string) => {
      requested.push(key)
      return key
    }) as never)

    expect(options).toEqual([
      { value: 'missing', label: 'translation.missing' },
      { value: 'complete', label: 'translation.complete' },
    ])
    expect(requested).not.toContain('translation.filter.missing_only')
    expect(requested).not.toContain('translation.filter.complete_only')
  })
})
```

- [✅] **Step 2: Run the test and verify RED**

Run from `sources/microservices/web-construct`:

```bash
npm test -- components/i18n/translations/translationStatusFilter.test.ts
```

Expected: FAIL because `translationStatusFilter` does not exist.

- [✅] **Step 3: Implement the pure option builder**

```ts
import type { TranslateFn } from '@/lib/i18n/types'

export function translationStatusFilterOptions(t: TranslateFn) {
  return [
    { value: 'missing' as const, label: t('translation.missing') },
    { value: 'complete' as const, label: t('translation.complete') },
  ]
}
```

Import the helper in `TranslationsTableClient.tsx` and replace the inline `filterParams.options` array with:

```ts
filterParams: { options: translationStatusFilterOptions(t) },
```

- [✅] **Step 4: Run the focused test and verify GREEN**

```bash
npm test -- components/i18n/translations/translationStatusFilter.test.ts
```

Expected: 1 test passed.

- [✅] **Step 5: Commit Task 1**

```bash
git add sources/microservices/web-construct/components/i18n/translations/translationStatusFilter.ts \
  sources/microservices/web-construct/components/i18n/translations/translationStatusFilter.test.ts \
  sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx
git commit -m "fix(i18n): simplify translation status labels"
```

---

### Task 2: Enforce global data-column resizing

**Files:**
- Create: `sources/microservices/web-construct/components/ui/gridColumnSizing.ts`
- Create: `sources/microservices/web-construct/components/ui/gridColumnSizing.test.ts`
- Create: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.test.tsx`
- Modify: `sources/microservices/web-construct/components/ui/DataGrid.tsx:27-56`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx:60-90`

**Interfaces:**
- Consumes: `ColDef<T>[]` from AG Grid.
- Produces: `GRID_MIN_COLUMN_WIDTH = 20` and `normalizeGridColumnDefs<T>(columnDefs: ColDef<T>[]): ColDef<T>[]`.

- [✅] **Step 1: Write the failing sizing tests**

```ts
import { describe, expect, it } from 'vitest'
import type { ColDef } from 'ag-grid-community'
import { GRID_MIN_COLUMN_WIDTH, normalizeGridColumnDefs } from './gridColumnSizing'

describe('normalizeGridColumnDefs', () => {
  it('keeps actions fixed and makes every data column freely resizable', () => {
    const actions: ColDef = { colId: 'actions', width: 56, resizable: false }
    const columns: ColDef[] = [
      actions,
      { field: 'key', initialWidth: 260, minWidth: 260, resizable: false },
      { field: 'description', initialWidth: 200 },
    ]

    const normalized = normalizeGridColumnDefs(columns)

    expect(GRID_MIN_COLUMN_WIDTH).toBe(20)
    expect(normalized[0]).toBe(actions)
    expect(normalized[0]).toMatchObject({ colId: 'actions', width: 56, resizable: false })
    expect(normalized[1]).toMatchObject({ field: 'key', initialWidth: 260, minWidth: 20, resizable: true })
    expect(normalized[2]).toMatchObject({ field: 'description', initialWidth: 200, minWidth: 20, resizable: true })
    expect(columns[1]).toMatchObject({ minWidth: 260, resizable: false })
  })
})
```

- [✅] **Step 2: Run the test and verify RED**

```bash
npm test -- components/ui/gridColumnSizing.test.ts
```

Expected: FAIL because `gridColumnSizing` does not exist.

- [✅] **Step 3: Implement the shared normalizer**

```ts
import type { ColDef } from 'ag-grid-community'

export const GRID_MIN_COLUMN_WIDTH = 20

export function normalizeGridColumnDefs<T>(columnDefs: ColDef<T>[]): ColDef<T>[] {
  return columnDefs.map(column => column.colId === 'actions'
    ? column
    : { ...column, resizable: true, minWidth: GRID_MIN_COLUMN_WIDTH })
}
```

In `DataGrid.tsx`, derive normalized definitions once:

```ts
const normalizedColumnDefs = useMemo(() => normalizeGridColumnDefs(columnDefs), [columnDefs])
```

Pass `normalizedColumnDefs` to both `AgGridReact.columnDefs` and `columnPinningState()`.

- [✅] **Step 4: Preserve translation initial widths without resetting user resize state**

In `TranslationsTableClient.tsx`, replace the three restrictive sizing declarations:

```ts
minWidth: 260
minWidth: 200
minWidth: 200
```

with the equivalent create-only initial widths:

```ts
initialWidth: 260
initialWidth: 200
initialWidth: 200
```

The shared normalizer then supplies `minWidth: 20` at runtime. `TranslationsTableClient.test.tsx` renders the component across a props-driven column-definition rebuild and asserts that these columns expose `initialWidth` without stateful `width`, protecting resize persistence at the AG Grid boundary.

- [✅] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- components/i18n/translations/TranslationsTableClient.test.tsx components/ui/gridColumnSizing.test.ts components/rbac/GridRowActionsMenu.test.ts
```

Expected: all tests passed; actions remains non-resizable and Translations definitions use only create-time widths across a rebuild.

- [✅] **Step 6: Commit Task 2**

```bash
git add sources/microservices/web-construct/components/ui/gridColumnSizing.ts \
  sources/microservices/web-construct/components/ui/gridColumnSizing.test.ts \
  sources/microservices/web-construct/components/ui/DataGrid.tsx \
  sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.test.tsx \
  sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx
git commit -m "fix(grid): allow unrestricted data column shrinking"
```

---

### Task 3: Full verification and browser regression check

**Files:**
- Modify: `docs/superpowers/plans/2026-07-31-grid-status-and-resize.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: verified implementation and completed plan checklist.

- [✅] **Step 1: Run the full automated gate**

From `sources/microservices/web-construct` run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all tests and build pass; lint has no errors. Existing unrelated warnings may remain.

- [✅] **Step 2: Verify Status in the browser**

Open `http://localhost:3000/admin/translations?sort=key&direction=ASC`, open the Status filter and confirm the only choices are `Complete` and `Missing` in English, or `Completa` and `Mancante` in Italian.

- [✅] **Step 3: Verify resizing in the browser**

On each of Utenti, Ruoli, Lingue and Traduzioni, drag at least one data-column divider left below its former content width and confirm it reaches approximately 20 px. Confirm the `...` actions column has no resize handle and remains 56 px. In Traduzioni, keep the resized width, apply a filter or sort that updates the URL and column definitions, and confirm the width remains unchanged.

- [✅] **Step 4: Complete tracking and commit**

Change every completed checkbox in this plan from `- [ ]` to `- [✅]`, then run:

```bash
git diff --check
git add docs/superpowers/plans/2026-07-31-grid-status-and-resize.md
git commit -m "docs: complete grid status and resize verification"
```
