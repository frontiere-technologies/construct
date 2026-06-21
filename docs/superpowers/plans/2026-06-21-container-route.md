# Container Route/URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Container menu items to have an optional Route/URL so that clicking them in the sidebar navigates to the route and simultaneously opens the children panel.

**Architecture:** Two surgical edits — remove the `type === 'link'` guards in the AdminMenuBuilder form, then update `L1Item` and `SubItem` in the Sidebar to render a `<Link>` whenever `item.route` is set (regardless of whether the item has children), while keeping the existing toggle-panel `onClick` handler in place.

**Tech Stack:** React 19, Next.js 15 (App Router), TypeScript, Playwright + Python (E2E tests via `uv run pytest`)

## Global Constraints

- Never use `python` or `python3` directly — always `uv run pytest` for tests
- Never modify `types/menu.ts` — `route` and `target` are already optional on all `MenuItem`s
- Never modify the database schema — `route` is already a nullable column
- Run `npm run build` from `apps/web/` to verify TypeScript after implementation steps
- E2E tests require a running dev server (`npm run dev` in `apps/web/`) on `http://localhost:3000`

---

### Task 1: AdminMenuBuilder — Route/URL field for Container

**Files:**
- Modify: `apps/web/components/AdminMenuBuilder.tsx:248-258` (Route/URL field guard)
- Modify: `apps/web/components/AdminMenuBuilder.tsx:311-323` (Open In field guard)
- Test: `tests/e2e/test_menu_builder.py`

**Interfaces:**
- Consumes: nothing new — existing form fields, existing `upsertMenuItem` action
- Produces: Route/URL and Open In fields visible for `container` type in the form

- [ ] **Step 1: Write the failing E2E test**

Append to `tests/e2e/test_menu_builder.py`:

```python
def test_container_route_field_visible_and_saves(logged_in_page, base_url):
    import uuid
    page = logged_in_page
    label = f"TEST-CONT-{uuid.uuid4().hex[:6]}"

    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")

    # Switch type to container
    page.locator('form select').first.select_option("container")

    # Route/URL field must be visible
    route_input = page.locator('form input[type="text"]').nth(1)
    assert route_input.is_visible(), "Route/URL field not visible for container type"

    # Fill form and save
    page.locator('form input[type="text"]').first.fill(label)
    page.locator('form select').nth(1).select_option("main")
    route_input.fill("/support")
    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")

    # Verify item saved
    item_row = page.locator('[data-testid="menu-item-row"]', has_text=label).first
    item_row.wait_for(state="visible", timeout=5_000)
    assert item_row.is_visible(), f"{label} not found after save"

    # Edit it and verify route persisted
    item_row.locator('[data-testid="edit-item-btn"]').click()
    saved_route = page.locator('form input[type="text"]').nth(1).input_value()
    assert saved_route == "/support", f"Route not persisted, got: {saved_route!r}"

    # Cleanup
    page.on("dialog", lambda d: d.accept())
    item_row.locator('[data-testid="delete-item-btn"]').click()
    page.wait_for_load_state("networkidle")
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
uv run pytest tests/e2e/test_menu_builder.py::test_container_route_field_visible_and_saves -v
```

Expected: FAIL — `AssertionError: Route/URL field not visible for container type`

- [ ] **Step 3: Remove the `type === 'link'` guard on the Route/URL field**

In `apps/web/components/AdminMenuBuilder.tsx`, replace:

```tsx
                {editingItem.type === 'link' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Route / URL</label>
                    <input
                      type="text"
                      value={editingItem.route || ''}
                      onChange={e => setEditingItem({ ...editingItem, route: e.target.value })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    />
                  </div>
                )}
```

With:

```tsx
                <div>
                  <label className="block text-sm font-medium mb-1">Route / URL</label>
                  <input
                    type="text"
                    value={editingItem.route || ''}
                    onChange={e => setEditingItem({ ...editingItem, route: e.target.value })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>
```

- [ ] **Step 4: Remove the `type === 'link'` guard on the Open In field**

In `apps/web/components/AdminMenuBuilder.tsx`, replace:

```tsx
                {editingItem.type === 'link' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Open In</label>
                    <select
                      value={editingItem.target ?? '_self'}
                      onChange={e => setEditingItem({ ...editingItem, target: e.target.value as '_blank' | '_self' })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="_self">Same tab</option>
                      <option value="_blank">New tab</option>
                    </select>
                  </div>
                )}
```

With:

```tsx
                <div>
                  <label className="block text-sm font-medium mb-1">Open In</label>
                  <select
                    value={editingItem.target ?? '_self'}
                    onChange={e => setEditingItem({ ...editingItem, target: e.target.value as '_blank' | '_self' })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  >
                    <option value="_self">Same tab</option>
                    <option value="_blank">New tab</option>
                  </select>
                </div>
```

- [ ] **Step 5: Build to verify TypeScript**

```bash
cd apps/web && npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 6: Run the new test**

```bash
uv run pytest tests/e2e/test_menu_builder.py::test_container_route_field_visible_and_saves -v
```

Expected: PASS

- [ ] **Step 7: Run the full menu builder test suite to check regressions**

```bash
uv run pytest tests/e2e/test_menu_builder.py -v
```

Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/AdminMenuBuilder.tsx tests/e2e/test_menu_builder.py
git commit -m "feat: show Route/URL and Open In for Container items in AdminMenuBuilder"
```

---

### Task 2: Sidebar — Container with route navigates and opens children panel

**Files:**
- Modify: `apps/web/components/Sidebar.tsx:70` (`L1Item` rendering condition)
- Modify: `apps/web/components/Sidebar.tsx:127-133` (`SubItem` rendering condition)
- Test: `tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: Container items with `route` set (created via Task 1's AdminMenuBuilder changes)
- Produces: `L1Item` and `SubItem` render as `<Link>` when `item.route` is set, with `onClick` still calling the panel-toggle handler

- [ ] **Step 1: Write the failing E2E test**

Append to `tests/e2e/test_sidebar.py`:

```python
def test_container_with_route_navigates_and_opens_l2(logged_in_page, base_url):
    import uuid
    page = logged_in_page
    parent_label = f"TEST-CONT-{uuid.uuid4().hex[:6]}"
    child_label = f"TEST-CHILD-{uuid.uuid4().hex[:6]}"

    # --- Setup: create container with route ---
    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")

    page.locator('form select').first.select_option("container")
    page.locator('form input[type="text"]').first.fill(parent_label)
    page.locator('form select').nth(1).select_option("main")
    page.locator('form input[type="text"]').nth(1).fill("/support")
    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")
    parent_row = page.locator('[data-testid="menu-item-row"]', has_text=parent_label).first
    parent_row.wait_for(state="visible", timeout=5_000)

    # --- Setup: create child link under container ---
    page.locator('form select').first.select_option("link")
    page.locator('form input[type="text"]').first.fill(child_label)
    page.locator('form select').nth(1).select_option("main")
    page.locator('form input[type="text"]').nth(1).fill("/support")
    # Parent Item is the third select (index 2: Type=0, Position=1, Parent=2)
    page.locator('form select').nth(2).select_option(label=parent_label)
    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")

    # --- Test: clicking container navigates AND opens col2 ---
    page.goto(f"{base_url}/")
    page.wait_for_load_state("networkidle")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)

    l1_btn(l1, parent_label).click()

    # Must navigate to /support
    page.wait_for_url("**/support", timeout=5_000)
    assert "/support" in page.url, f"Expected /support, got {page.url}"

    # Col2 must open (child panel visible)
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    assert page.locator("aside").count() >= 2, "Col2 did not open after clicking container with route"

    # --- Cleanup: delete parent (cascades to child) ---
    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")
    page.on("dialog", lambda d: d.accept())
    page.locator('[data-testid="menu-item-row"]', has_text=parent_label).first.locator('[data-testid="delete-item-btn"]').click()
    page.wait_for_load_state("networkidle")
    assert page.locator('[data-testid="menu-item-row"]', has_text=parent_label).count() == 0
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
uv run pytest tests/e2e/test_sidebar.py::test_container_with_route_navigates_and_opens_l2 -v
```

Expected: FAIL — the container renders as a `<button>` (not a `<Link>`), so `wait_for_url` times out — navigation does not happen.

- [ ] **Step 3: Update `L1Item` in `Sidebar.tsx`**

In `apps/web/components/Sidebar.tsx`, in the `L1Item` component, replace:

```tsx
  if (!hasChildren && item.route) {
```

With:

```tsx
  if (item.route) {
```

This makes containers with both a route and children render as a `<Link>` (which handles navigation) while keeping `onClick={onClick}` (which calls `handleL1Click` to toggle the children panel).

- [ ] **Step 4: Update `SubItem` in `Sidebar.tsx`**

In `apps/web/components/Sidebar.tsx`, in the `SubItem` component, replace:

```tsx
  if (hasChildren) {
    return (
      <button onClick={onContainerClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
        {icon}{label}
      </button>
    )
  }

  if (item.route) {
    return (
      <Link
        href={item.route}
        target={item.target}
        rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        className={cls}
      >
        {icon}{label}
      </Link>
    )
  }
```

With:

```tsx
  if (hasChildren && item.route) {
    return (
      <Link
        href={item.route}
        onClick={onContainerClick}
        target={item.target}
        rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        className={cls}
      >
        {icon}{label}
      </Link>
    )
  }

  if (hasChildren) {
    return (
      <button onClick={onContainerClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
        {icon}{label}
      </button>
    )
  }

  if (item.route) {
    return (
      <Link
        href={item.route}
        target={item.target}
        rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        onMouseEnter={tooltipEnter}
        onMouseLeave={tooltipLeave}
        className={cls}
      >
        {icon}{label}
      </Link>
    )
  }
```

- [ ] **Step 5: Build to verify TypeScript**

```bash
cd apps/web && npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 6: Run the new test**

```bash
uv run pytest tests/e2e/test_sidebar.py::test_container_with_route_navigates_and_opens_l2 -v
```

Expected: PASS

- [ ] **Step 7: Run the full sidebar + highlight test suite to check regressions**

```bash
uv run pytest tests/e2e/test_sidebar.py tests/e2e/test_highlight.py -v
```

Expected: all tests PASS. Key regressions to watch:
- `test_admin_opens_l2` — Admin container (no route) still opens col2 on click ✓
- `test_support_navigation` — Support link (with route, no children) still navigates ✓
- `test_admin_closes_l2_on_second_click` — collapsible behavior unchanged ✓

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/Sidebar.tsx tests/e2e/test_sidebar.py
git commit -m "feat: container with route navigates and opens children panel in sidebar"
```
