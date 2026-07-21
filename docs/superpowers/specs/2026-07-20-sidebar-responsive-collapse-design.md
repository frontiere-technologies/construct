# Sidebar Responsive Auto-Collapse Design

**Goal:** When the browser window is narrower than 768px, the sidebar's per-column text/icon toggle (col1/col2/col3) must automatically render in icon-only mode, so the layout never breaks the way it does today when a text-mode column is squeezed by a narrow viewport. The independent full-collapse control (`masterCollapsed`, thin re-expand rail) is out of scope — it stays entirely user-controlled regardless of viewport width.

**Non-goals:**
- No new localStorage field, no change to the existing `sidebarCollapseState` schema.
- No change to `masterCollapsed` behavior.
- No change to child components' props/signatures (`L1Item`, `SubItem`, `ColToggle`, user panel) beyond one new optional prop on `ColToggle`.

## Architecture

Add one new piece of client-only state to `Sidebar.tsx`, derived from a `matchMedia` query, following the same "read after mount to avoid SSR hydration mismatch" pattern already used for the localStorage-backed collapse state:

```ts
const [isNarrowViewport, setIsNarrowViewport] = useState(false)

useEffect(() => {
  const mq = window.matchMedia('(max-width: 767px)')
  setIsNarrowViewport(mq.matches)
  const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches)
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}, [])
```

Three derived, purely computed booleans (not stored, not persisted) replace the raw collapse state at every *rendering* call site:

```ts
const effCol1Collapsed = isNarrowViewport || col1Collapsed
const effCol2Collapsed = isNarrowViewport || col2Collapsed
const effCol3Collapsed = isNarrowViewport || col3Collapsed
```

The underlying `col1Collapsed`/`col2Collapsed`/`col3Collapsed` state, their setters, and their localStorage persistence in `COLLAPSE_KEY` are unchanged — they remain the user's saved preference and are never written to as a result of viewport width. `masterCollapsed` and its rail are unaffected by any of this.

## Components affected

All changes are confined to `sources/microservices/web-construct/components/Sidebar.tsx`, at existing rendering call sites — no new components, no new props on `L1Item`/`SubItem`.

- **Column width classes**: the three `<aside>` elements currently pick `ICON_COL_W`/`TEXT_COL_W` (or `ICON_SUB_W`/`TEXT_SUB_W`) based on `col1Collapsed`/`col2Collapsed`/`col3Collapsed`. Each switches to the corresponding `effColXCollapsed`.
- **`isCollapsed` props**: every `L1Item`, `SubItem`, and the user-panel row currently receives `isCollapsed={colXCollapsed}`. Each switches to `effColXCollapsed`.
- **`ColToggle`** (the small chevron button that flips a column between text/icon): gains an optional `disabled?: boolean` prop. When `disabled` is true, the component renders `null` instead of the button. Each of the three call sites passes `collapsed={effColXCollapsed}` and `disabled={isNarrowViewport}`. Below the breakpoint there is nothing useful the toggle could do — the column is forced to icon mode regardless of what the button would set — so it disappears rather than sitting inert.
- **Master-collapse button** ("Collassa menu" row in col1): unaffected in behavior (still calls `setMasterCollapsed(true)`, still always clickable). Only its label visibility (icon+text vs icon-only) switches from `col1Collapsed` to `effCol1Collapsed`, so it visually matches the forced icon-only column around it.

## Data flow

One `matchMedia` listener → one boolean state → three pure derivations consumed at render time. No new writes to localStorage, no new keys, no interaction with `masterCollapsed`.

## Error handling

None needed beyond what already exists: `matchMedia` is called only inside `useEffect` (client-side only, same guard already used for `localStorage` access elsewhere in this file), so there is no SSR access to browser-only APIs.

## Testing

New Playwright e2e tests appended to `sources/tests/e2e/test_sidebar.py`, following the existing convention in that file (`page.locator("aside").first`, `bounding_box()["width"]` comparisons, as in `test_l1_expands`/`test_l1_collapses`):

1. Expand col1 to text mode (`ensure_l1_expanded`), then shrink the viewport below 768px via `page.set_viewport_size(...)` — assert col1's bounding-box width drops to the icon-mode width, and that `[data-testid="sidebar-toggle"]` is not visible on col1.
2. Restore the viewport above 768px — assert col1 returns to its previous (text-mode) width and the toggle is visible again.
3. A variant covering col2 (open a section with children so col2 renders in text mode, e.g. via `ensure_l2_open` or equivalent) to confirm the same forced-icon behavior applies to a non-col1 column, per the "all three columns" scope decision.

Manual verification: resize the actual browser window across 768px while col1/col2/col3 are each in text mode, and confirm no layout breakage (no squeeze/overlap), toggle chevrons disappear/reappear at the boundary, and the master-collapse rail is untouched by the resize.
