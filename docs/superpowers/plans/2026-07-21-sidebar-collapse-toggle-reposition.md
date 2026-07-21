# Sidebar Collapse-Toggle Reposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline master-collapse button in col1 (currently to the left of the account/avatar row) and the bare `ColToggle` chevron circles on col1/col2/col3 with a single stacked-circle control per column: an `✕` circle (collapse-to-rail for col1, close-panel for col2/col3) stacked directly above the existing `‹`/`›` chevron circle.

**Architecture:** One new shared component, `ColToggleStack`, replaces the existing `ColToggle` component in `components/Sidebar.tsx`. It renders up to two absolutely-positioned circular buttons (✕ on top, chevron below) anchored to `-right-3` of whichever element is its nearest `relative` ancestor. For col2/col3 that ancestor is the `<aside>` itself (same anchor point `ColToggle` used today — bottom-anchored). For col1 it's a new `relative` wrapper around just the account-button row, so the stack is vertically centered against that row instead of bottom-anchored to the whole column.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS v4 (`clsx`), `lucide-react` icons (adds `X`, drops `PanelLeftClose`), Playwright/pytest e2e.

## Global Constraints

- Preserve `data-testid="sidebar-master-toggle"` on col1's `✕` exactly — existing e2e tests (`test_master_collapse_hides_sidebar`, `test_master_collapse_expand_restores_l2`, `test_master_collapse_persists_after_reload`, `test_hover_preview_hides_master_toggle`) depend on it and must keep passing unmodified.
- Preserve `data-testid="sidebar-toggle"` on every column's chevron button exactly — `helpers.ensure_l1_expanded`/`ensure_l1_collapsed` depend on it.
- No new npm dependency — reuse `lucide-react`'s `X` icon (already an installed package) and the existing `clsx` helper.
- Single component file changes: `sources/microservices/web-construct/components/Sidebar.tsx`, plus its e2e test file `sources/tests/e2e/test_sidebar.py`. No new files, no new context/state.
- col3's close action has **no automated e2e coverage** in this plan: per repository investigation, no seed menu item under "Admin" is itself a container with its own children, so col3 is currently unreachable through the running app in the e2e environment (col3 already has zero existing test coverage today). Implement it identically to col2 for correctness and symmetry, but do not invent new seed/fixture data to force col3 open — that's out of scope.

---

### Task 1: `ColToggleStack` component + close (✕) button on col2 and col3

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx:8` (import), `:47-60` (new component, added after existing `ColToggle`), `:505` (col2 call site), `:596` (col3 call site)
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Produces: `ColToggleStack` component with props `{ collapsed: boolean; onToggleCollapse: () => void; toggleDisabled?: boolean; onClose: () => void; closeTestId: string; closeTitle?: string; hideClose?: boolean; anchorClassName: string }`. Task 2 consumes this exact signature for col1.
- Consumes: existing `setCol2Collapsed`, `setCol3Collapsed`, `setSelectedL1Id`, `setSelectedL2Id`, `setUserPanelOpen`, `isNarrowViewport` (all already defined earlier in `Sidebar.tsx`, unchanged).

- [ ] **Step 1: Write the failing e2e test for col2's close button**

Add to `sources/tests/e2e/test_sidebar.py` (after `test_admin_closes_l2_on_second_click`, which is the last test touching col2's admin panel):

```python
def test_col2_close_button_closes_admin_panel(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    col2 = page.locator("aside").nth(1)
    col2.wait_for(state="visible", timeout=5_000)
    assert page.locator("aside").count() >= 2, "Admin panel did not open"

    col2.locator('[data-testid="sidebar-col-close"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length < 2",
        timeout=5_000,
    )
    assert page.locator("aside").count() < 2, "col2 did not close after clicking its close button"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_col2_close_button_closes_admin_panel -v`
Expected: FAIL — Playwright times out waiting for `[data-testid="sidebar-col-close"]` to appear (it doesn't exist yet).

- [ ] **Step 3: Add the `X` import**

In `sources/microservices/web-construct/components/Sidebar.tsx:8`, change:

```tsx
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
```

to:

```tsx
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
```

(`PanelLeftClose` is still used by col1's inline button until Task 2 removes it — do not delete it in this task.)

- [ ] **Step 4: Add the `ColToggleStack` component**

In `sources/microservices/web-construct/components/Sidebar.tsx`, immediately after the existing `ColToggle` component (after line 60, before `interface L1ItemProps`), add:

```tsx
const ColToggleStack: React.FC<{
  collapsed: boolean
  onToggleCollapse: () => void
  toggleDisabled?: boolean
  onClose: () => void
  closeTestId: string
  closeTitle?: string
  hideClose?: boolean
  anchorClassName: string
}> = ({ collapsed, onToggleCollapse, toggleDisabled, onClose, closeTestId, closeTitle, hideClose, anchorClassName }) => (
  <div className={clsx('absolute -right-3 flex flex-col gap-1 z-10', anchorClassName)}>
    {!hideClose && (
      <button
        data-testid={closeTestId}
        onClick={onClose}
        title={closeTitle}
        className="flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg"
      >
        <X size={14} className="text-sidebar-text/60" />
      </button>
    )}
    {!toggleDisabled && (
      <button
        data-testid="sidebar-toggle"
        onClick={onToggleCollapse}
        className="flex items-center justify-center bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg"
      >
        {collapsed
          ? <ChevronRight size={14} className="text-sidebar-text/60" />
          : <ChevronLeft size={14} className="text-sidebar-text/60" />}
      </button>
    )}
  </div>
)
```

- [ ] **Step 5: Wire col2 to `ColToggleStack`**

In `sources/microservices/web-construct/components/Sidebar.tsx:505`, replace:

```tsx
          <ColToggle collapsed={effCol2Collapsed} onToggle={() => setCol2Collapsed(c => !c)} disabled={isNarrowViewport} />
```

with:

```tsx
          <ColToggleStack
            collapsed={effCol2Collapsed}
            onToggleCollapse={() => setCol2Collapsed(c => !c)}
            toggleDisabled={isNarrowViewport}
            onClose={() => { setSelectedL1Id(null); setSelectedL2Id(null); setUserPanelOpen(false) }}
            closeTestId="sidebar-col-close"
            closeTitle="Chiudi pannello"
            anchorClassName="bottom-4"
          />
```

- [ ] **Step 6: Wire col3 to `ColToggleStack`**

In `sources/microservices/web-construct/components/Sidebar.tsx:596`, replace:

```tsx
          <ColToggle collapsed={effCol3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} disabled={isNarrowViewport} />
```

with:

```tsx
          <ColToggleStack
            collapsed={effCol3Collapsed}
            onToggleCollapse={() => setCol3Collapsed(c => !c)}
            toggleDisabled={isNarrowViewport}
            onClose={() => setSelectedL2Id(null)}
            closeTestId="sidebar-col-close"
            closeTitle="Chiudi pannello"
            anchorClassName="bottom-4"
          />
```

- [ ] **Step 7: Run the new test to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_col2_close_button_closes_admin_panel -v`
Expected: PASS

- [ ] **Step 8: Run the full sidebar suite to check for regressions**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -v`
Expected: all tests PASS (col1 is untouched in this task, so nothing here should break).

- [ ] **Step 9: Lint**

Run: `cd sources/microservices/web-construct && npm run lint`
Expected: no new errors (pre-existing warnings in unrelated files are fine).

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "$(cat <<'EOF'
feat(sidebar): add close button above col2/col3 collapse toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migrate col1's master-collapse to the stacked circle

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx:47-60` (remove old `ColToggle`), `:421` (remove call), `:454-497` (restructure account section)
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: `ColToggleStack` from Task 1 (exact signature above) — no changes to that component in this task.

- [ ] **Step 1: Write the failing e2e tests**

Add to `sources/tests/e2e/test_sidebar.py` (after `test_hover_preview_hides_master_toggle`):

```python
def test_master_toggle_not_left_of_avatar_when_l1_expanded(logged_in_page):
    # Regression test for: the master-collapse toggle used to sit inline,
    # to the left of the account button, inside the same flex row. It now
    # lives in its own absolutely-positioned stack anchored to the right
    # edge of the column, so it must never be to the account button's left.
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    toggle_box = l1.locator('[data-testid="sidebar-master-toggle"]').bounding_box()
    avatar_box = l1.locator('[data-testid="sidebar-account-button"]').bounding_box()
    assert toggle_box is not None, "Master-collapse toggle not found"
    assert avatar_box is not None, "Account button not found"
    assert toggle_box["x"] > avatar_box["x"], (
        "Master-collapse toggle should sit to the right of the account button, not to its left"
    )


def test_master_toggle_works_when_l1_expanded(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    assert page.locator('[data-testid="sidebar-collapsed-rail"]').is_visible()
```

- [ ] **Step 2: Run the new tests to verify the positioning test fails**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_master_toggle_not_left_of_avatar_when_l1_expanded sources/tests/e2e/test_sidebar.py::test_master_toggle_works_when_l1_expanded -v`
Expected:
- `test_master_toggle_not_left_of_avatar_when_l1_expanded` FAILS — today the toggle is `order-1` (renders first / to the left) and the account button is `order-2`, so `toggle_box["x"] < avatar_box["x"]`. It also fails earlier because `[data-testid="sidebar-account-button"]` doesn't exist yet (added in Step 4 below).
- `test_master_toggle_works_when_l1_expanded` already PASSES on current code (the inline button already works in text mode) — that's expected; it's included as regression coverage for the upcoming refactor, not as a red/green driver.

- [ ] **Step 3: Remove the old `ColToggle` component and its col1 call site**

In `sources/microservices/web-construct/components/Sidebar.tsx`, delete the `ColToggle` component definition (lines 47-60):

```tsx
const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void; disabled?: boolean }> = ({ collapsed, onToggle, disabled }) => {
  if (disabled) return null
  return (
    <button
      data-testid="sidebar-toggle"
      onClick={onToggle}
      className="absolute -right-3 bottom-4 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg z-10"
    >
      {collapsed
        ? <ChevronRight size={14} className="text-sidebar-text/60" />
        : <ChevronLeft size={14} className="text-sidebar-text/60" />}
    </button>
  )
}
```

And delete its col1 call site (line 421, right after `<aside className={...}>` opens):

```tsx
        <ColToggle collapsed={effCol1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} disabled={isNarrowViewport} />
```

- [ ] **Step 4: Restructure col1's bottom account section**

Replace the whole block (originally lines 454-497 — the `<div className={clsx('mt-1 border-t ...')}>...</div>` containing the old inline master-toggle button and the account button):

```tsx
          <div className={clsx(
            'mt-1 border-t border-sidebar-text/10 pt-3 transition-colors duration-200',
            effCol1Collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2'
          )}>
            {!isPreview && (
              <button
                data-testid="sidebar-master-toggle"
                onClick={() => setMasterCollapsed(true)}
                title="Collassa menu"
                className={clsx(
                  'flex items-center justify-center rounded-lg text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text transition-colors duration-200',
                  effCol1Collapsed ? 'w-full py-2 order-2' : 'flex-shrink-0 p-1.5 order-1'
                )}
              >
                <PanelLeftClose size={20} className="flex-shrink-0" />
              </button>
            )}

            {/* User section — clickable, opens user panel in col2 */}
            <button
              onClick={handleUserClick}
              onMouseEnter={effCol1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? 'Account') : undefined}
              onMouseLeave={effCol1Collapsed ? hideTooltip : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-lg transition-colors duration-200',
                effCol1Collapsed ? 'w-full justify-center py-1 order-1' : 'flex-1 min-w-0 py-1 px-1 order-2',
                userPanelOpen
                  ? 'text-sidebar-active-text'
                  : 'text-sidebar-text hover:text-sidebar-active-text'
              )}
            >
              {authUser?.image
                ? <Image src={authUser.image} alt="" width={26} height={26} className="rounded-full flex-shrink-0" />
                : <CircleUser size={26} className={clsx('flex-shrink-0 transition-colors', userPanelOpen ? 'text-primary' : 'opacity-60')} />
              }
              {!effCol1Collapsed && (
                <div className="flex flex-col min-w-0 flex-1 text-left">
                  <TruncatedSpan text={authUser?.email?.split('@')[0] ?? ''} className="text-xs font-medium truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                  <TruncatedSpan text={authUser?.email ?? ''} className="text-xs opacity-50 truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                </div>
              )}
            </button>
          </div>
```

with:

```tsx
          <div className="mt-1 border-t border-sidebar-text/10 pt-3 transition-colors duration-200 relative">
            {/* User section — clickable, opens user panel in col2 */}
            <button
              data-testid="sidebar-account-button"
              onClick={handleUserClick}
              onMouseEnter={effCol1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? 'Account') : undefined}
              onMouseLeave={effCol1Collapsed ? hideTooltip : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-lg transition-colors duration-200 w-full',
                effCol1Collapsed ? 'justify-center py-1' : 'py-1 px-1',
                userPanelOpen
                  ? 'text-sidebar-active-text'
                  : 'text-sidebar-text hover:text-sidebar-active-text'
              )}
            >
              {authUser?.image
                ? <Image src={authUser.image} alt="" width={26} height={26} className="rounded-full flex-shrink-0" />
                : <CircleUser size={26} className={clsx('flex-shrink-0 transition-colors', userPanelOpen ? 'text-primary' : 'opacity-60')} />
              }
              {!effCol1Collapsed && (
                <div className="flex flex-col min-w-0 flex-1 text-left">
                  <TruncatedSpan text={authUser?.email?.split('@')[0] ?? ''} className="text-xs font-medium truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                  <TruncatedSpan text={authUser?.email ?? ''} className="text-xs opacity-50 truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                </div>
              )}
            </button>

            <ColToggleStack
              collapsed={effCol1Collapsed}
              onToggleCollapse={() => setCol1Collapsed(c => !c)}
              toggleDisabled={isNarrowViewport}
              onClose={() => setMasterCollapsed(true)}
              closeTestId="sidebar-master-toggle"
              closeTitle="Collassa menu"
              hideClose={isPreview}
              anchorClassName="top-1/2 -translate-y-1/2"
            />
          </div>
```

- [ ] **Step 5: Remove the now-unused `PanelLeftClose` import**

In `sources/microservices/web-construct/components/Sidebar.tsx:8`, change:

```tsx
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
```

to:

```tsx
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftOpen, X } from 'lucide-react'
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_master_toggle_not_left_of_avatar_when_l1_expanded sources/tests/e2e/test_sidebar.py::test_master_toggle_works_when_l1_expanded -v`
Expected: both PASS

- [ ] **Step 7: Run the full sidebar suite**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -v`
Expected: all tests PASS, including `test_hover_preview_hides_master_toggle` (unmodified — same testid, still gated by `hideClose={isPreview}`) and every Task 1 test.

- [ ] **Step 8: Lint**

Run: `cd sources/microservices/web-construct && npm run lint`
Expected: no new errors, and no `no-unused-vars` warning for `PanelLeftClose` (it's been removed from the import).

- [ ] **Step 9: Manual visual verification**

Using the webapp-testing skill (Playwright, headless), log in, expand col1 (`ensure_l1_expanded` equivalent), and screenshot the bottom of col1 in both icon-only and text sub-states. Confirm the `✕`/`‹` stack sits at the right edge, vertically centered on the account row, matching the approved mockup in `docs/superpowers/specs/2026-07-21-sidebar-collapse-toggle-reposition-design.md`. Also confirm col2's `✕` (opened via "Admin") closes the panel, and that the hover-preview overlay (masterCollapsed + hover) still hides col1's `✕` while showing its `‹` chevron.

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "$(cat <<'EOF'
refactor(sidebar): move master-collapse toggle into the stacked circle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
