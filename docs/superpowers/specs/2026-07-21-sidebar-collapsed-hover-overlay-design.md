# Sidebar Collapsed Rail — Slimmer Strip + Hover Overlay — Design Spec

**Status:** Approved by user, ready for planning.

## Problem

The master-collapsed rail introduced in [2026-07-20-sidebar-master-collapse-design.md](./2026-07-20-sidebar-master-collapse-design.md) is a thin `aside` (`w-8`, 32px) with a single `PanelLeftOpen` icon (18px) that, on click, permanently re-expands the sidebar (`masterCollapsed → false`), pushing the main content over.

Two problems with the current rail, from a screenshot the user shared:

1. It's not narrow enough — the user wants it "molto più stretto", with a smaller icon that's nonetheless slightly more visible (more contrast) given the reduced size.
2. There's no quick way to peek at the menu without permanently expanding it. The user wants hovering over the collapsed rail to reveal the full sidebar (L1 + col2/col3, whatever was open before collapsing) as a floating overlay on top of the main content — without resizing the main content area, the way a permanent expand does.

## Design

### Rail sizing

- `RAIL_W` changes from `w-8` (32px) to `w-6` (24px).
- The `PanelLeftOpen` icon shrinks from `size={18}` to `size={14}`.
- Icon color opacity increases from `text-sidebar-text/60` to `text-sidebar-text/70` (idle) so it stays legible at the smaller size; the existing `hover:text-sidebar-active-text` hover state is unchanged.
- Click behavior on the rail is **unchanged**: it still calls `setMasterCollapsed(false)`, permanently pinning the sidebar expanded (existing e2e coverage in `test_sidebar.py` for this stays valid as-is).

### New state: `hoverPreviewOpen`

A new boolean, local to `Sidebar.tsx`, not persisted to `localStorage` (it's a transient UI affordance, not a preference).

- Opens/closes with a ~180ms debounce in both directions ("hover intent"), to avoid flicker when the pointer passes over the rail quickly or moves toward the overlay content.
- Implemented with a `hoveringRef` (tracks whether the pointer is currently over the rail *or* the overlay) plus two timers (`openTimerRef`, `closeTimerRef`):
  - `onMouseEnter` (rail or overlay): mark `hoveringRef.current = true`, clear any pending close timer, schedule an open after 180ms.
  - `onMouseLeave` (rail or overlay): mark `hoveringRef.current = false`, clear any pending open timer, schedule a close after 180ms that only fires if `hoveringRef.current` is still `false` when the timer runs (guards against the gap between leaving the rail and entering the adjacent overlay).
- Only relevant when `masterCollapsed` is `true`; when `masterCollapsed` is `false` the state is inert (no rail to hover).

### Overlay content and rendering

- The existing JSX block that renders col1/col2/col3 (currently gated by `{!masterCollapsed && (...)}`, lines ~377-579) is reused as-is for the overlay — same components, same collapsed/expanded sub-states (`col1Collapsed`/`col2Collapsed`/`col3Collapsed`), same `selectedL1Id`/`selectedL2Id`/`userPanelOpen`. No duplicate markup or duplicate logic; it's the identical tree, just rendered in a different container depending on which mode is active.
- When `masterCollapsed && hoverPreviewOpen`, this block renders via `createPortal` to `document.body` (following the existing tooltip portal pattern in this same file), wrapped in a `position: fixed` container:
  - Anchored at `left-6` (24px, matching the rail width) so it sits flush against the rail with no gap.
  - `top-0`, full viewport height.
  - `shadow-2xl` and a high `z-index` (above normal page content, below the tooltip portal) so it visually floats above the main content.
  - `data-testid="sidebar-hover-preview"` on the wrapper for e2e targeting.
  - Carries the same `onMouseEnter`/`onMouseLeave` hover-intent handlers described above.
- When `masterCollapsed` is `false` (pinned-expanded or never collapsed), the block renders inline in the normal flex flow exactly as it does today — no behavior change there.
- Because the overlay is `position: fixed` and portaled to `document.body`, it never affects the flex layout of the page: the rail (`w-6`) remains the only sidebar-related element in flow, so the main content's width is untouched while the overlay is showing.

### Closing the overlay on navigation

- A new `useEffect` keyed on `pathname` closes `hoverPreviewOpen` (and clears any pending timers) whenever the route actually changes. This means:
  - Clicking a `Link` inside the overlay navigates and the overlay closes (rail stays collapsed) — matches "naviga e l'overlay si richiude, resta collassato".
  - Clicking a container item inside the overlay (e.g. to expand col2/col3) does **not** close the overlay, since no route change occurs — the user can drill into sub-levels while previewing.
- This is additive to the existing `pathname` effect that resets `selectedL1Id`/`selectedL2Id` (lines ~259-279); it does not change that effect's existing behavior.

### Interaction summary

| Action | Effect |
|---|---|
| Hover over collapsed rail (~180ms) | `hoverPreviewOpen → true`; full sidebar appears as a fixed overlay next to the rail, main content unaffected |
| Move pointer away from rail and overlay (~180ms) | `hoverPreviewOpen → false`; overlay disappears |
| Click collapsed rail | `masterCollapsed → false` (unchanged); sidebar pins expanded in normal flow, main content resizes as it does today |
| Click a nav `Link` inside the overlay | Navigates; `hoverPreviewOpen` closes on route change; rail stays collapsed |
| Click a container item (L1/L2) inside the overlay | Expands col2/col3 within the overlay; overlay stays open |

## Architecture

- **`components/Sidebar.tsx`**:
  - Change `RAIL_W` from `'w-8'` to `'w-6'`; change the rail icon to `size={14}` and bump its opacity class.
  - Add `hoverPreviewOpen` state, `hoveringRef`, `openTimerRef`, `closeTimerRef`, and the enter/leave handler pair.
  - Add the `pathname`-keyed effect that closes `hoverPreviewOpen` on navigation.
  - Attach the enter/leave handlers to the collapsed rail's `<aside>`.
  - Render the existing col1/col2/col3 block in two places depending on mode: inline when `!masterCollapsed` (unchanged), and via `createPortal` in a fixed wrapper when `masterCollapsed && hoverPreviewOpen` (new). Both call sites render the same JSX so there's no fork in column logic — only the wrapper differs.

No other files need changes — no new components, no new context, no new library (React's `createPortal`, already imported, covers this).

## Testing

- New e2e tests in `sources/tests/e2e/test_sidebar.py`:
  - Hovering the collapsed rail reveals `sidebar-hover-preview` with the sidebar columns inside it.
  - Moving the pointer away closes the preview.
  - Clicking a nav item inside the preview navigates and closes the preview, while `masterCollapsed` (and therefore the rail) remains.
  - The main content's bounding box width does not change while the preview is open (confirms it's a true overlay, not a layout push).
  - Existing click-to-pin tests (`test_master_collapse_expand_restores_l2`, `test_master_collapse_persists_after_reload`, `test_master_collapse_hides_sidebar`) continue to pass unmodified.
- Manual verification in the browser (Playwright via the webapp-testing skill) before considering the work done, per this project's standing convention for frontend changes.

## Out of Scope

- Changing what "pinned expanded" (`masterCollapsed = false`) looks like or how it's triggered — only the collapsed-rail's hover affordance and its visual size are new.
- Any backdrop/dimming behind the overlay — it's a plain floating panel with a shadow, no scrim.
- Touch/keyboard-only equivalents of the hover preview — out of scope for this pass; click-to-pin remains the accessible fallback.
- Persisting `hoverPreviewOpen` to `localStorage` — it's transient UI state, not a preference.
