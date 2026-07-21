# Sidebar Master Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a control that fully collapses the left sidebar (all three columns) down to a thin re-expand rail, independent of the existing per-column text/icon toggle.

**Architecture:** A single new boolean state `masterCollapsed` in `components/Sidebar.tsx`, persisted in the existing `sidebarCollapseState` localStorage key. When `true`, the existing three-`aside` block doesn't render at all and a new thin `aside` with one expand button renders instead. When `false`, everything renders exactly as it does today, plus one new "collapse" button fixed at the top of column 1.

**Tech Stack:** React 19 / TypeScript, Tailwind CSS v4, `clsx`, `lucide-react` icons (`PanelLeftClose`, `PanelLeftOpen`), Python/Playwright e2e tests (`uv run pytest`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-sidebar-master-collapse-design.md`
- The existing `data-testid="sidebar-toggle"` and its text↔icon behavior must not change.
- No logo is added anywhere — out of scope per the spec.
- New localStorage field name: `master` (inside the existing `sidebarCollapseState` JSON object).
- New `data-testid` values: `sidebar-master-toggle` (button in col1) and `sidebar-collapsed-rail` (button in the collapsed rail).

---

### Task 1: Master collapse state, UI, and persistence in `Sidebar.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx`
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: existing `col1Collapsed`/`col2Collapsed`/`col3Collapsed` state, existing `readCollapse(key, defaultValue)` helper, existing `COLLAPSE_KEY` localStorage key — all defined earlier in the same file (no changes to their behavior).
- Produces: new `masterCollapsed: boolean` state (default `false`), new `data-testid="sidebar-master-toggle"` button and `data-testid="sidebar-collapsed-rail"` button, both consumed only by the new e2e tests in this task (no other file depends on them).

This is a single task because the state, the two buttons, and the conditional rendering only make sense — and can only be tested — together; there is no meaningful intermediate state a reviewer could approve independently.

- [ ] **Step 1: Write the failing e2e tests**

Open `sources/tests/e2e/test_sidebar.py` and append these three tests at the end of the file (the file already imports `ensure_l2_open` at the top, so no new imports are needed):

```python
def test_master_collapse_hides_sidebar(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    rail = page.locator('[data-testid="sidebar-collapsed-rail"]')
    assert rail.is_visible()
    assert page.locator("aside").count() == 1


def test_master_collapse_expand_restores_l2(logged_in_page):
    page = logged_in_page
    ensure_l2_open(page)
    assert page.locator("aside").count() >= 2, "L2 did not open before collapsing"

    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )

    page.locator('[data-testid="sidebar-collapsed-rail"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length >= 2",
        timeout=5_000,
    )
    assert page.locator("aside").count() >= 2, "L2 was not restored after expanding"


def test_master_collapse_persists_after_reload(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )

    page.reload()
    page.wait_for_load_state("networkidle")
    page.locator('[data-testid="sidebar-collapsed-rail"]').wait_for(state="visible", timeout=5_000)
    assert page.locator("aside").count() == 1, "Master-collapsed state did not persist after reload"
```

- [ ] **Step 2: Start the dev server and run the tests to verify they fail**

In one terminal, from `sources/microservices/web-construct/`:
```bash
npm run dev
```

In another terminal, from the repo root:
```bash
uv run pytest sources/tests/e2e/test_sidebar.py -k master_collapse -v
```

Expected: all three FAIL — Playwright times out waiting for `[data-testid="sidebar-master-toggle"]`, since that element doesn't exist yet (`TimeoutError: Locator.click: Timeout ... waiting for locator("[data-testid=\"sidebar-master-toggle\"]")`).

- [ ] **Step 3: Add the `PanelLeftClose`/`PanelLeftOpen` icon imports**

In `sources/microservices/web-construct/components/Sidebar.tsx`, find:

```typescript
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight } from 'lucide-react'
```

Replace with:

```typescript
import { LogOut, Sun, Moon, CircleUser, User, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
```

- [ ] **Step 4: Add the collapsed-rail width constant**

Find:

```typescript
const ICON_COL_W = 'w-16'
const TEXT_COL_W = 'w-52'
const ICON_SUB_W = 'w-14'
const TEXT_SUB_W = 'w-48'
const COLLAPSE_KEY = 'sidebarCollapseState'
```

Replace with:

```typescript
const ICON_COL_W = 'w-16'
const TEXT_COL_W = 'w-52'
const ICON_SUB_W = 'w-14'
const TEXT_SUB_W = 'w-48'
const RAIL_W = 'w-8'
const COLLAPSE_KEY = 'sidebarCollapseState'
```

- [ ] **Step 5: Widen `readCollapse`'s key type to include `'master'`**

Find:

```typescript
const readCollapse = (key: 'col1' | 'col2' | 'col3', defaultValue: boolean): boolean => {
```

Replace with:

```typescript
const readCollapse = (key: 'col1' | 'col2' | 'col3' | 'master', defaultValue: boolean): boolean => {
```

- [ ] **Step 6: Add `masterCollapsed` state, its localStorage load, and its localStorage save**

Find:

```typescript
  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(true)
  const [col2Collapsed, setCol2Collapsed] = useState<boolean>(false)
  const [col3Collapsed, setCol3Collapsed] = useState<boolean>(false)

  // Load from localStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    setCol1Collapsed(readCollapse('col1', true))
    setCol2Collapsed(readCollapse('col2', false))
    setCol3Collapsed(readCollapse('col3', false))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed])
```

Replace with:

```typescript
  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(true)
  const [col2Collapsed, setCol2Collapsed] = useState<boolean>(false)
  const [col3Collapsed, setCol3Collapsed] = useState<boolean>(false)
  const [masterCollapsed, setMasterCollapsed] = useState<boolean>(false)

  // Load from localStorage after mount to avoid SSR hydration mismatch
  useEffect(() => {
    setCol1Collapsed(readCollapse('col1', true))
    setCol2Collapsed(readCollapse('col2', false))
    setCol3Collapsed(readCollapse('col3', false))
    setMasterCollapsed(readCollapse('master', false))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed, master: masterCollapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed, masterCollapsed])
```

- [ ] **Step 7: Insert the master-collapse button at the top of column 1, and open the `!masterCollapsed` wrapper**

Find:

```typescript
      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        col1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={col1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} />

        {topItems.length > 0 && (
```

Replace with:

```typescript
      {!masterCollapsed && (
      <>
      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        col1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={col1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} />

        <div className="p-2 border-b border-sidebar-text/10">
          <button
            data-testid="sidebar-master-toggle"
            onClick={() => setMasterCollapsed(true)}
            title="Collassa menu"
            className={clsx(
              'w-full flex items-center rounded-lg py-2 px-3 text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text transition-colors duration-200',
              col1Collapsed ? 'justify-center' : 'gap-3'
            )}
          >
            <PanelLeftClose size={20} className="flex-shrink-0" />
            {!col1Collapsed && <span className="text-sm">Collassa menu</span>}
          </button>
        </div>

        {topItems.length > 0 && (
```

- [ ] **Step 8: Close the `!masterCollapsed` wrapper and add the collapsed-rail `aside`**

Find (the tail end of the file, the col3 `aside` block followed by the component's closing):

```typescript
      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} />
          {!col3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={menuItems.find(i => i.id === selectedL2Id)?.label ?? ''}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col3Collapsed} isSelected={false}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
```

Replace with:

```typescript
      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} />
          {!col3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={menuItems.find(i => i.id === selectedL2Id)?.label ?? ''}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col3Collapsed} isSelected={false}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}
      </>
      )}

      {masterCollapsed && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg border-r border-sidebar-text/10 flex flex-col items-center flex-shrink-0',
          RAIL_W
        )}>
          <button
            data-testid="sidebar-collapsed-rail"
            onClick={() => setMasterCollapsed(false)}
            title="Espandi menu"
            className="mt-2 p-1.5 rounded-lg text-sidebar-text/60 hover:bg-sidebar-active-bg hover:text-sidebar-active-text"
          >
            <PanelLeftOpen size={18} />
          </button>
        </aside>
      )}
    </div>
  )
}
```

- [ ] **Step 9: Run the tests to verify they pass**

With the dev server still running from Step 2:
```bash
uv run pytest sources/tests/e2e/test_sidebar.py -v
```

Expected: PASS for all tests in the file, including the 3 new ones and every pre-existing test (`test_l1_sidebar_visible`, `test_l1_expands`, `test_l1_collapses`, `test_admin_opens_l2`, etc. — none of their selectors changed).

- [ ] **Step 10: Manual browser verification**

With the dev server running, open `http://localhost:3000` in a browser (or drive it via the webapp-testing skill), log in, and check:
- Column 1 shows the new "Collassa menu" row above Home/Admin, both in text mode and in icon-only mode (toggle with the existing chevron first to confirm both look right).
- Clicking it hides the entire sidebar, leaving only a thin rail with one arrow-style icon.
- Hovering the rail button shows the "Espandi menu" native tooltip.
- Clicking the rail button restores the sidebar to whatever state it was in before (try it once with Admin's L2 panel open, and once without).
- Reload the page after collapsing: the sidebar stays collapsed (rail only) after reload.
- Reload after expanding: the sidebar stays expanded.

- [ ] **Step 11: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "$(cat <<'EOF'
feat(sidebar): add full-collapse control for the left menu

Adds a master toggle, independent of the existing per-column
text/icon toggle, that hides the whole sidebar behind a thin
re-expand rail. State persists in the existing sidebarCollapseState
localStorage key.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- New `masterCollapsed` state + persistence → Step 6.
- Master toggle button in col1, always visible regardless of `col1Collapsed` → Step 7.
- Full hide of col1/col2/col3, thin rail with expand button when collapsed → Steps 7-8.
- `selectedL1Id`/`selectedL2Id`/`userPanelOpen` untouched by master collapse → satisfied structurally (Step 6/7/8 never reference or reset these; `test_master_collapse_expand_restores_l2` verifies it).
- Existing `sidebar-toggle` behavior unchanged → no edits touch `ColToggle` itself.
- No logo added → confirmed, no logo-related code anywhere in this plan.
- e2e tests for hide, restore, and persistence → Step 1.
- Manual browser check → Step 10.

**Placeholder scan:** No TBD/TODO; every step has literal, complete code or exact commands.

**Type consistency:** `masterCollapsed`/`setMasterCollapsed` names match across Steps 6-8. `readCollapse('master', false)` matches the widened key type from Step 5. `RAIL_W` defined in Step 4 and used only in Step 8. `data-testid` values (`sidebar-master-toggle`, `sidebar-collapsed-rail`) match exactly between the JSX (Steps 7-8) and the tests (Step 1).
