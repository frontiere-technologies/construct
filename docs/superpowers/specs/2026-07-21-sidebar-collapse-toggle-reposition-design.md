# Sidebar — Reposition Collapse Controls as Stacked Circles — Design Spec

**Status:** Approved by user, ready for planning.

## Problem

The master-collapse button ("Collassa menu", `PanelLeftClose` icon, `data-testid="sidebar-master-toggle"`) currently sits inline, to the left of the account button (avatar + email), in the bottom section of col1. The user doesn't like this placement — visually it competes with the account row and reads as if it belongs to the user block.

Separately, there is no way to close col2 or col3 (the L1-children / L2-children panels) without either navigating away or fully re-collapsing/re-expanding col1's icon/text mode. The existing per-column `ColToggle` (`data-testid="sidebar-toggle"`, the small circular `‹`/`›` button anchored at `-right-3 bottom-4` of each `<aside>`) only toggles that column between icon-only and text width — it doesn't close a column.

## Design

### Unified mechanism: a second circle stacked above the existing one

Every column that already has a `ColToggle` circle (col1, col2, col3) gets a second, identically styled circle stacked directly above it (same `-right-3` horizontal anchor, same size/border/shadow), containing an `✕` icon. The existing chevron circle is unchanged in behavior and appearance.

- **col1's `✕`** — collapses the whole sidebar into the rail/hover-preview mode. This is exactly today's `setMasterCollapsed(true)` action; the button keeps `data-testid="sidebar-master-toggle"` so existing e2e coverage (`test_master_collapse_hides_sidebar`, `test_master_collapse_expand_restores_l2`, `test_master_collapse_persists_after_reload`) keeps working unmodified — only the DOM location of the button changes, not its testid or behavior.
  - The old inline button (next to the account row, in both icon-only and text-width bottom sections) is removed entirely. The `✕`+chevron stack is the only way to trigger master-collapse now, in **both** col1 sub-states (icon-only and text).
  - Positioning: unlike col2/col3 (see below), col1's stack is vertically centered against the account button row (avatar + email), not bottom-anchored to the aside. The account-row's wrapping `<div>` becomes a `relative` positioning context, and the `✕`+chevron stack is `absolute -right-3 top-1/2 -translate-y-1/2` within it — this guarantees the stack's center aligns with the row's center regardless of row height, rather than relying on a tuned pixel offset.
  - Hidden when rendered inside the hover-preview overlay (`isPreview` — the same flag and rationale as the fix in `2026-07-21-sidebar-collapsed-hover-overlay-design.md`): collapsing something that's already collapsed is meaningless there.
  - Not disabled on narrow viewports (mobile) — master-collapse remains meaningful regardless of viewport width, matching today's behavior.

- **col2's `✕`** — closes col2 entirely: deselects whatever caused it to show (`selectedL1Id → null`, `selectedL2Id → null`, and `userPanelOpen → false` if that's what's open), leaving only col1. This is a new action; the column doesn't just shrink to icon-only (the chevron already does that) — it disappears, exactly like navigating away would.
  - Positioning: bottom-anchored to the aside, same as its `ColToggle` today (`-right-3`, stacked above the existing `bottom-4` chevron) — no row to center against here.
  - Visible in the hover-preview overlay too — closing a sub-panel is a legitimate action there, independent of `masterCollapsed`.
  - New `data-testid` for e2e targeting (not shared with col1's, since both can be visible at once) — reusing the existing shared-testid pattern used by `ColToggle` (`data-testid="sidebar-toggle"` is already identical across col1/col2/col3 and tests scope it via the parent `<aside>` locator), so a single shared testid like `sidebar-col-close` is fine, scoped the same way in tests.

- **col3's `✕`** — same as col2, symmetric: `selectedL2Id → null`, leaving col1+col2. Same positioning and visibility rules as col2.

### Visual reference

Both mockup iterations were validated interactively via the brainstorming visual companion:
- Stack order and horizontal anchor (X directly above the existing chevron, same right-edge alignment).
- col1's stack vertically centered against the account row height, positioned low (near the bottom of the aside, not mid-column) — not a separate row at the top of the sidebar (an earlier, rejected alternative).
- col2/col3's stack bottom-anchored like today, no centering needed.

## Architecture

- **`components/Sidebar.tsx`**:
  - Remove the inline master-toggle `<button>` (currently rendered in the bottom account section for both icon-only and text sub-states of col1).
  - Extend the `ColToggle` rendering into a two-circle stack. Whether this is a new `ColToggleGroup` component wrapping `ColToggle` plus a new `ColClose`-style button, or two components composed by the caller, is left to the implementation plan — but the chevron's existing styling/behavior/testid must be preserved unchanged.
  - col1: wrap the account-button row in a `relative` div; position the stack `absolute -right-3 top-1/2 -translate-y-1/2` inside it, gated by `!isPreview`.
  - col2/col3: position the stack `absolute -right-3 bottom-4` (X above, chevron below) on the respective `<aside>`, same as today's single `ColToggle` anchor point.
  - Wire the two new close handlers (col2, col3) to the existing state setters (`setSelectedL1Id`, `setSelectedL2Id`, `setUserPanelOpen`) — no new state needed.

No other files change — no new context, no new library.

## Testing

- Update existing sidebar e2e tests that reference `sidebar-master-toggle` only if its DOM position matters to them (it currently doesn't — they just click it and check the resulting layout), so they should keep passing unmodified.
- New e2e coverage in `sources/tests/e2e/test_sidebar.py`:
  - col1's `✕` (via `sidebar-master-toggle`) still triggers master-collapse from both col1 sub-states (icon-only and text).
  - col1's `✕` does not appear inside the hover-preview overlay (mirrors `test_hover_preview_hides_master_toggle`, now targeting the new location).
  - col2's `✕` closes col2 (asserts `aside` count decreases / admin panel disappears) without affecting col1.
  - col3's `✕` closes col3 without affecting col1/col2.
- Manual verification in the browser (Playwright via the webapp-testing skill) before considering the work done, per this project's standing convention for frontend changes.

## Out of Scope

- Any change to what `ColToggle`'s chevron does (icon/text width toggle) — unchanged.
- Any change to the hover-preview overlay's opening/closing mechanics — unchanged, only the master-toggle's position within it is affected (still hidden there, same as before).
- Keyboard/accessibility affordances for the new close buttons beyond what `ColToggle` already has (none currently) — out of scope for this pass.
