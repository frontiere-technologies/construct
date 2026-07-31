# Grid Minimum Column Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep grid headers readable by enforcing a 112 px minimum on every resizable data column while leaving the fixed actions column unchanged.

**Architecture:** Continue using `normalizeGridColumnDefs` as the shared sizing boundary for every `DataGrid`. Change only its exported minimum-width constant and lock the behavior with the existing focused unit test.

**Tech Stack:** TypeScript, React 19, AG Grid Community, Vitest

## Global Constraints

- Every non-actions grid column must remain resizable and have an exact minimum width of 112 px.
- The column whose `colId` is `actions` must remain unchanged and non-resizable.
- Existing `initialWidth` values must remain initial-only values so column-definition refreshes do not reset manual widths.
- Caller-provided column definitions must not be mutated.

---

### Task 1: Enforce the readable grid minimum width

**Files:**
- Modify: `sources/microservices/web-construct/components/ui/gridColumnSizing.test.ts`
- Modify: `sources/microservices/web-construct/components/ui/gridColumnSizing.ts`
- Modify: `docs/superpowers/specs/2026-07-31-grid-minimum-column-width-design.md`

**Interfaces:**
- Consumes: `normalizeGridColumnDefs<T>(columnDefs: ColDef<T>[]): ColDef<T>[]` and `GRID_MIN_COLUMN_WIDTH` from `components/ui/gridColumnSizing.ts`.
- Produces: `GRID_MIN_COLUMN_WIDTH = 112`; normalized non-actions definitions with `resizable: true` and `minWidth: 112`; unchanged actions definitions.

- [✅] **Step 1: Change the focused assertion to describe the required minimum**

Update the existing test so its name and assertions require 112 px:

```ts
it('keeps actions fixed and gives every data column a readable resize minimum', () => {
  const actions: ColDef = { colId: 'actions', width: 56, resizable: false }
  const columns: ColDef[] = [
    actions,
    { field: 'key', initialWidth: 260, minWidth: 260, resizable: false },
    { field: 'description', initialWidth: 200 },
  ]

  const normalized = normalizeGridColumnDefs(columns)

  expect(GRID_MIN_COLUMN_WIDTH).toBe(112)
  expect(normalized[0]).toBe(actions)
  expect(normalized[0]).toMatchObject({ colId: 'actions', width: 56, resizable: false })
  expect(normalized[1]).toMatchObject({ field: 'key', initialWidth: 260, minWidth: 112, resizable: true })
  expect(normalized[2]).toMatchObject({ field: 'description', initialWidth: 200, minWidth: 112, resizable: true })
  expect(columns[1]).toMatchObject({ minWidth: 260, resizable: false })
})
```

- [✅] **Step 2: Run the focused test and verify RED**

Run from `sources/microservices/web-construct`:

```bash
npm test -- components/ui/gridColumnSizing.test.ts
```

Expected: FAIL because `GRID_MIN_COLUMN_WIDTH` and normalized `minWidth` values are still `20`.

- [✅] **Step 3: Implement the minimal shared change**

In `gridColumnSizing.ts`, change only the shared constant:

```ts
export const GRID_MIN_COLUMN_WIDTH = 112
```

Keep `normalizeGridColumnDefs` otherwise unchanged.

- [✅] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- components/ui/gridColumnSizing.test.ts
```

Expected: PASS with the actions definition preserved, both data definitions normalized to 112 px, and the input definition unmodified.

- [✅] **Step 5: Run complete automated verification**

Run from `sources/microservices/web-construct`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands exit 0. Existing documented lint warnings may remain, but no new warning or error may be introduced.

- [ ] **Step 6: Verify the browser behavior**

Open `/admin/translations`, drag at least one data-column resize handle left, and verify its width stops at 112 px while the beginning of the title and the filter control remain visible. Verify the `...` column stays fixed and has no resize handle.

- [ ] **Step 7: Mark the design checklist complete and commit**

Change the completed checkboxes in `docs/superpowers/specs/2026-07-31-grid-minimum-column-width-design.md` from `- [ ]` to `- [✅]`, then commit only the files from this task:

```bash
git add sources/microservices/web-construct/components/ui/gridColumnSizing.test.ts sources/microservices/web-construct/components/ui/gridColumnSizing.ts docs/superpowers/specs/2026-07-31-grid-minimum-column-width-design.md docs/superpowers/plans/2026-07-31-grid-minimum-column-width.md
git commit -m "fix(grid): keep resized headers readable"
```
