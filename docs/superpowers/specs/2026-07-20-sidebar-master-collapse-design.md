# Sidebar Master Collapse — Design Spec

**Status:** Approved by user, ready for planning.

## Problem

`Sidebar.tsx` already lets each of its three columns (col1/col2/col3) toggle independently between a "text" and an "icon-only" width via the existing `ColToggle` chevron button. There is no way to hide the left menu entirely: col1 (the icon rail) is always at least `w-16` wide. The user asked for a control — inspired by a screenshot of another app — that fully collapses the whole left menu area down to a thin strip, leaving only a button to bring it back.

The reference screenshot also showed back/forward history navigation arrows above the collapse icon; that's an unrelated feature of the other app and is explicitly out of scope here. The reference app's collapsed state also hides a logo — this app's sidebar has no logo today (only `Login.tsx` has one), so no logo is added as part of this work.

## Design

### New state: `masterCollapsed`

A new boolean, `masterCollapsed` (default `false`), stored in `Sidebar.tsx` alongside the existing `col1Collapsed` / `col2Collapsed` / `col3Collapsed`. It is independent of those three — it does not overwrite or read them, it only decides whether the whole sidebar structure renders at all.

- Persisted in the same `localStorage` key (`sidebarCollapseState`) used today, adding a `master` field to the JSON object: `{ col1, col2, col3, master }`.
- Read via the same post-mount pattern as the other three flags (to avoid SSR hydration mismatch) and written via the same combined `useEffect` that already serializes the object on change.
- `selectedL1Id`, `selectedL2Id`, and `userPanelOpen` are **not** reset or touched when `masterCollapsed` changes in either direction. This means if col2/col3 were open before collapsing, they reappear exactly as they were when the sidebar is re-expanded.

### Rendering

**When `masterCollapsed` is `false`** (normal operation, unchanged except for one addition):
- Col1 gains a new fixed row above `topItems`, always visible regardless of `col1Collapsed` (text or icon-only mode): a button with the `PanelLeftClose` icon (lucide-react), `data-testid="sidebar-master-toggle"`. Clicking it sets `masterCollapsed` to `true`.
- Everything else in col1/col2/col3 (existing `ColToggle`, L1/L2/L3 items, user panel, theme toggle, logout) is unchanged — same components, same `data-testid="sidebar-toggle"` for the existing per-column toggle.

**When `masterCollapsed` is `true`**:
- None of the existing three `aside` columns render.
- A single new thin `aside` (`w-8`) renders in their place, containing exactly one button: `PanelLeftOpen` icon, `data-testid="sidebar-collapsed-rail"`, with a `title="Espandi menu"` attribute for a native tooltip. Clicking it sets `masterCollapsed` back to `false`.
- No logo, no menu items, no user avatar — the entire menu area is gone, matching the requested behavior.

### Interaction summary

| Action | Effect |
|---|---|
| Click `sidebar-master-toggle` (in col1) | `masterCollapsed → true`; col1/col2/col3 disappear, thin rail appears |
| Click `sidebar-collapsed-rail` button | `masterCollapsed → false`; sidebar returns to its prior `col1Collapsed`/`col2Collapsed`/`col3Collapsed`/selection state |
| Reload page | `masterCollapsed` restored from `localStorage`, same as the other three flags |
| Existing `sidebar-toggle` (col1/col2/col3 chevron) | Unchanged; independent of master collapse |

## Architecture

- **`components/Sidebar.tsx`**:
  - Add `masterCollapsed` state + its `localStorage` read/write, following the exact pattern of `col1Collapsed` etc. (lines ~212-227).
  - Add `PanelLeftClose`, `PanelLeftOpen` to the existing `lucide-react` import (line 8).
  - Add the new master-toggle row at the top of the col1 `aside`, before the `topItems` block (around line 360).
  - Wrap the existing three-`aside` block (lines ~343-536, i.e. everything inside the outer `<div className="flex h-screen ...">`) in a conditional: render it only when `!masterCollapsed`; render the new thin collapsed-rail `aside` when `masterCollapsed` is `true`. The outer wrapping `<div>` and the tooltip portal stay as-is since they're not specific to any column.

No other files need changes — no logo component, no new context, no new library.

## Testing

- New e2e tests in `sources/tests/e2e/test_sidebar.py`:
  - Clicking `sidebar-master-toggle` hides all the original `aside` columns and leaves only the collapsed rail visible.
  - Clicking the collapsed rail's button restores the sidebar to its previous width/state (e.g. if col2 was open, it reappears).
  - The collapsed state survives a page reload (localStorage persistence), mirroring how `test_l1_collapses` verifies the existing toggle.
- Manual verification in the browser (Playwright via the webapp-testing skill) before considering the work done, per this project's standing convention for frontend changes.

## Out of Scope

- Any logo in the sidebar (doesn't exist today; not being added).
- Back/forward history navigation arrows (unrelated feature from the reference screenshot).
- Changing the existing `col1Collapsed`/`col2Collapsed`/`col3Collapsed` toggle behavior or its `data-testid="sidebar-toggle"`.
- A 3-state cycle on a single button — explicitly rejected in favor of two independent controls.
