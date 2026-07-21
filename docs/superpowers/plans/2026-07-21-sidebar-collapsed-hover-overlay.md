# Sidebar Collapsed Rail — Slimmer Strip + Hover Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the master-collapsed sidebar rail narrower with a smaller-but-legible icon, and let hovering it reveal the full sidebar as a floating overlay on top of the main content — without resizing the main content, and without changing the existing click-to-pin (permanent expand) behavior.

**Architecture:** `components/Sidebar.tsx` already conditionally renders either the three expanded columns (col1/col2/col3) or a thin collapsed rail, based on `masterCollapsed`. We add a new transient `hoverPreviewOpen` state driven by hover-intent (debounced enter/leave) on the rail. The exact same column JSX used for the pinned-expanded case is extracted into a `sidebarColumns` constant and, when collapsed + hovered, rendered a second time via `createPortal` to `document.body` inside a `position: fixed` wrapper anchored next to the rail — so it floats over `<main>` without touching page layout.

**Tech Stack:** React 19 + TypeScript, Next.js 16 App Router, Tailwind CSS v4, `clsx`, `lucide-react` icons, `react-dom` `createPortal` (already used in this file for the tooltip). E2E tests: Python + Playwright via `uv run pytest`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-sidebar-collapsed-hover-overlay-design.md` — follow it exactly; this plan implements it.
- Rail width: `w-6` (24px), down from `w-8` (32px).
- Rail icon: `PanelLeftOpen` at `size={14}`, down from `size={18}`; idle color opacity `text-sidebar-text/70`, up from `/60`.
- Hover-intent debounce: ~180ms in both directions (open and close).
- Click on the rail keeps its current behavior unchanged: `setMasterCollapsed(false)` (permanent pin, main content resizes as today). Do not alter this.
- The hover overlay must reuse the exact same column JSX as the pinned-expanded render — no forked/duplicated markup.
- `hoverPreviewOpen` is not persisted to `localStorage` — it is transient UI state only.
- The overlay closes when the route actually changes (real navigation), but stays open when a container (L1/L2) is merely expanded within it (no route change).
- No new files, no new dependencies. All changes are in `components/Sidebar.tsx` (implementation) and `sources/tests/e2e/test_sidebar.py` (tests).
- Dev server must be running (`cd sources/microservices/web-construct && npm run dev`, serving `http://localhost:3000`) before running any `uv run pytest` command against `sources/tests/e2e/`.

---

### Task 1: Slim the collapsed rail

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx:42` (the `RAIL_W` constant)
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx:581-595` (the collapsed-rail `<aside>` block)
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: nothing new — pure styling change to existing, already-rendered elements (`data-testid="sidebar-master-toggle"` and `data-testid="sidebar-collapsed-rail"`, both already present and used by existing tests).
- Produces: the collapsed rail's `aside` is now ≤28px wide (down from 32px). Later tasks (Task 2) attach hover handlers to this same `<aside>` — no other task depends on new names here.

- [ ] **Step 1: Write the failing test**

Add to the end of `sources/tests/e2e/test_sidebar.py`:

```python
def test_collapsed_rail_is_narrow(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    rail = page.locator("aside").first
    width = rail.bounding_box()["width"]
    assert width <= 28, f"Collapsed rail is not narrow enough: {width:.0f}px"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_collapsed_rail_is_narrow -v`
Expected: FAIL — `width` is `32` (current `w-8`), so `32 <= 28` is false.

- [ ] **Step 3: Implement the narrower rail**

In `sources/microservices/web-construct/components/Sidebar.tsx`, change line 42:

```ts
const RAIL_W = 'w-6'
```

(was `const RAIL_W = 'w-8'`)

Then change the collapsed-rail block (currently lines 581-595):

```tsx
      {masterCollapsed && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg border-r border-sidebar-text/10 flex flex-col items-center flex-shrink-0',
          RAIL_W
        )}>
          <button
            data-testid="sidebar-collapsed-rail"
            onClick={() => setMasterCollapsed(false)}
            title="Espandi menu"
            className="mt-auto mb-2 p-1 rounded-lg text-sidebar-text/70 hover:bg-sidebar-active-bg hover:text-sidebar-active-text"
          >
            <PanelLeftOpen size={14} />
          </button>
        </aside>
      )}
```

(changes from the original: `p-1.5` → `p-1` so the button fits the narrower rail without overflow, `text-sidebar-text/60` → `text-sidebar-text/70`, `size={18}` → `size={14}`)

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py::test_collapsed_rail_is_narrow -v`
Expected: PASS

- [ ] **Step 5: Run the full sidebar suite to check for regressions**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -v`
Expected: All tests PASS (existing master-collapse tests only check visibility/count, not exact width, so they're unaffected).

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "feat(sidebar): slim the collapsed rail to 24px with a smaller, higher-contrast icon"
```

---

### Task 2: Hover-preview overlay for the collapsed rail

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx` (state/handlers near line 233, render block currently at lines 377-579, rail block from Task 1)
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: `RAIL_W`, `masterCollapsed`/`setMasterCollapsed`, `pathname` (from `usePathname()`), `createPortal` (already imported at line 4) — all already present in the file.
- Produces: `data-testid="sidebar-hover-preview"` on the portal wrapper `<div>`, for e2e targeting. No other component consumes this.

- [ ] **Step 1: Write the failing e2e tests**

Add to the end of `sources/tests/e2e/test_sidebar.py`:

```python
def test_hover_shows_preview_overlay(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    rail = page.locator("aside").first
    rail.hover()
    preview = page.locator('[data-testid="sidebar-hover-preview"]')
    preview.wait_for(state="visible", timeout=2_000)
    assert preview.locator("aside").count() >= 1, "Preview overlay has no sidebar columns inside it"


def test_hover_preview_closes_on_mouse_leave(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    rail = page.locator("aside").first
    rail.hover()
    preview = page.locator('[data-testid="sidebar-hover-preview"]')
    preview.wait_for(state="visible", timeout=2_000)

    page.mouse.move(800, 450)  # move well into the main content area, away from rail and overlay
    preview.wait_for(state="hidden", timeout=2_000)


def test_hover_preview_navigation_closes_it(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    rail = page.locator("aside").first
    rail.hover()
    preview = page.locator('[data-testid="sidebar-hover-preview"]')
    preview.wait_for(state="visible", timeout=2_000)

    url_before = page.url
    preview.locator("a").first.click()
    page.wait_for_function(
        "url => window.location.href !== url",
        arg=url_before,
        timeout=5_000,
    )
    preview.wait_for(state="hidden", timeout=2_000)
    assert page.locator("aside").count() == 1, "Rail should still be the only sidebar column after navigating"


def test_hover_preview_does_not_resize_main_content(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    l1.locator('[data-testid="sidebar-master-toggle"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length === 1",
        timeout=5_000,
    )
    main = page.locator("main").first
    width_before = main.bounding_box()["width"]

    rail = page.locator("aside").first
    rail.hover()
    page.locator('[data-testid="sidebar-hover-preview"]').wait_for(state="visible", timeout=2_000)
    width_after = main.bounding_box()["width"]

    assert width_after == width_before, f"Main content resized during hover preview: {width_before:.0f}px → {width_after:.0f}px"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -k hover_preview -v`
Expected: FAIL — `[data-testid="sidebar-hover-preview"]` does not exist yet, so every `preview.wait_for(state="visible", ...)` call times out.

- [ ] **Step 3: Implement the hover-preview state and overlay**

In `sources/microservices/web-construct/components/Sidebar.tsx`, insert this new block immediately after the existing persistence `useEffect` that currently ends at line 233 (`}, [col1Collapsed, col2Collapsed, col3Collapsed, masterCollapsed])`), and before the `// Below this viewport width...` comment at line 235:

```tsx
  // Hover-preview overlay for the collapsed rail: hovering it (with a short
  // debounce) shows the full sidebar as a floating overlay instead of
  // permanently expanding. Purely transient — never persisted, and it does
  // not read or write masterCollapsed/col1Collapsed/col2Collapsed/col3Collapsed.
  const [hoverPreviewOpen, setHoverPreviewOpen] = useState(false)
  const hoveringRef = useRef(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleHoverEnter = useCallback(() => {
    hoveringRef.current = true
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = setTimeout(() => setHoverPreviewOpen(true), 180)
  }, [])

  const handleHoverLeave = useCallback(() => {
    hoveringRef.current = false
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      if (!hoveringRef.current) setHoverPreviewOpen(false)
    }, 180)
  }, [])

  // Closes the preview on a real route change; container-expand clicks
  // inside the preview don't change the route, so they don't close it.
  useEffect(() => {
    setHoverPreviewOpen(false)
  }, [pathname])

  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])
```

Next, cut lines 378-578 of the same file (the `<>...</>` fragment containing the three `<aside>` columns — L1, col2, col3 — currently the body of `{!masterCollapsed && ( ... )}`) exactly as they are, and paste them as the value of a new `const sidebarColumns = ( ... )`, declared immediately above the `return (` statement (currently line 365):

```tsx
  const sidebarColumns = (
    <>
    {/* ...the exact, unmodified content of the former lines 379-577 goes here... */}
    </>
  )

  return (
```

Then replace what used to be lines 377-579 (the now-removed `{!masterCollapsed && (<>...</>)}` block) with:

```tsx
      {!masterCollapsed && sidebarColumns}

      {masterCollapsed && hoverPreviewOpen && createPortal(
        <div
          data-testid="sidebar-hover-preview"
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className="fixed top-0 left-6 h-screen z-40 shadow-2xl flex"
        >
          {sidebarColumns}
        </div>,
        document.body
      )}
```

Finally, wire the hover handlers onto the collapsed-rail `<aside>` added in Task 1 (so hovering anywhere on the 24px strip — not just the button — triggers the preview):

```tsx
      {masterCollapsed && (
        <aside
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
          className={clsx(
            'h-screen bg-sidebar-bg border-r border-sidebar-text/10 flex flex-col items-center flex-shrink-0',
            RAIL_W
          )}
        >
          <button
            data-testid="sidebar-collapsed-rail"
            onClick={() => setMasterCollapsed(false)}
            title="Espandi menu"
            className="mt-auto mb-2 p-1 rounded-lg text-sidebar-text/70 hover:bg-sidebar-active-bg hover:text-sidebar-active-text"
          >
            <PanelLeftOpen size={14} />
          </button>
        </aside>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -k hover_preview -v`
Expected: PASS

- [ ] **Step 5: Run the full sidebar suite to check for regressions**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py -v`
Expected: All tests PASS, including the existing click-to-pin tests (`test_master_collapse_hides_sidebar`, `test_master_collapse_expand_restores_l2`, `test_master_collapse_persists_after_reload`) and Task 1's `test_collapsed_rail_is_narrow`.

- [ ] **Step 6: Manual verification in the browser**

Using the `webapp-testing` skill (Playwright), against the running dev server:
- Collapse the sidebar via the master-toggle button.
- Hover the narrow rail: confirm the full sidebar fades in as a floating panel over the page content, with a visible shadow, and the main content does not shift or resize.
- Move the mouse away: confirm the panel disappears after a brief, natural-feeling delay (no flicker).
- Hover, then click a top-level nav item: confirm it navigates and the panel closes, while the rail stays collapsed.
- Hover, then click a container item (one with sub-items): confirm it expands col2/col3 inside the panel without closing it.
- Click the rail directly (no hover panel needed): confirm the sidebar still pins open permanently and the main content resizes, exactly as before this change.

- [ ] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "feat(sidebar): reveal full menu as a hover overlay when the rail is collapsed"
```

---

## Self-Review Notes

- **Spec coverage:** Rail sizing (Task 1) ✓. Hover-intent debounce, portal overlay, unchanged click-to-pin, navigation-closes/container-stays-open, no main-content resize, new e2e coverage (Task 2) ✓. All spec sections covered; nothing deferred.
- **Placeholders:** None — every step shows complete, real code or an exact, mechanically-verifiable line range for the one pure relocation (moving existing, already-fully-shown code into a constant, with no edits inside it).
- **Type consistency:** `hoverPreviewOpen`/`setHoverPreviewOpen`, `handleHoverEnter`/`handleHoverLeave`, `hoveringRef`, `openTimerRef`/`closeTimerRef`, and `sidebarColumns` are named identically everywhere they're declared and used across both tasks.
- **Scope:** Single cohesive feature (one component, one test file) — no decomposition into sub-plans needed.
