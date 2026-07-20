def nav(page, url: str) -> None:
    """Navigate to a URL and wait for the network to settle."""
    page.goto(url)
    page.wait_for_load_state("networkidle")


def open_column_filter(page, col_id: str):
    """Click the funnel icon on an AG Grid column header to open its filter popup.

    Note: the installed AG Grid build uses the Theming API (not the legacy
    CSS themes), so the clickable filter icon is `[data-ref="eFilterButton"]`
    (class `ag-header-cell-filter-button`) — the `ag-filter-icon` class only
    marks the (usually hidden) "filter active" indicator, not the button.
    """
    header = page.locator(f'.ag-header-cell[col-id="{col_id}"]')
    header.locator('.ag-header-cell-filter-button').click()


def grid_rows(page):
    """All data rows in an AG Grid.

    Note: with the Theming API build in use here, rows live directly under
    `.ag-grid-scrolling-rows` — there is no `.ag-center-cols-container`
    wrapper (that class belongs to the legacy CSS theme DOM). Since these
    grids have no pinned columns, `.ag-row` alone is unambiguous.
    """
    return page.locator('.ag-row')


def do_test_login(page, base_url: str, email: str) -> None:
    """Authenticate via the test-credentials form (requires AUTH_TEST_CREDENTIALS=true on server)."""
    nav(page, f"{base_url}/login")
    page.click('button:has-text("Accesso test")')
    page.fill('input[placeholder="Email di test"]', email)
    page.click('button:has-text("Entra (test)")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    page.wait_for_load_state("networkidle")


def _tree_row(page, text):
    """The tree row (with a drag handle) whose label is `text`."""
    return page.locator("div").filter(has_text=text).filter(
        has=page.locator('[data-testid="drag-handle"]')
    ).last


def drag_row_onto(page, drag_text: str, target_text: str, rel_y: float = 0.85) -> None:
    """Drag the tree row labelled `drag_text` onto `target_text` at `rel_y` of its height.
    rel_y > 0.5 drops *after* the target (rel_y=0.85 → after the last row exercises F-02)."""
    handle = _tree_row(page, drag_text).locator('[data-testid="drag-handle"]')
    tgt = _tree_row(page, target_text)
    hb = handle.bounding_box()
    tb = tgt.bounding_box()
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    page.mouse.down()
    # small move to pass the 5px activation distance, then glide to the target
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2 + 10, steps=3)
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] * rel_y, steps=15)
    # dnd-kit processes drag-move on rAF; wait until the insertion indicator actually
    # reflects the final pointer position before releasing (deterministic, not a fixed sleep).
    page.locator('[data-testid^="drop-line"]').first.wait_for(state="visible", timeout=3_000)
    page.mouse.up()
    page.wait_for_load_state("networkidle")


def tree_labels(page):
    """Ordered list of visible tree-row labels."""
    return [s.strip() for s in page.locator('.rounded-lg.border span.flex-1').all_inner_texts()]


def ensure_l1_expanded(page, l1) -> None:
    """Expand L1 column if currently collapsed (icon-only = width < 100px)."""
    box = l1.bounding_box()
    if box and box["width"] < 100:
        l1.locator('[data-testid="sidebar-toggle"]').click()
        page.wait_for_function(
            "() => document.querySelector('aside').getBoundingClientRect().width >= 100",
            timeout=5_000,
        )


def ensure_l1_collapsed(page, l1) -> None:
    """Collapse L1 column if currently expanded."""
    box = l1.bounding_box()
    if box and box["width"] >= 100:
        l1.locator('[data-testid="sidebar-toggle"]').click()
        page.wait_for_function(
            "() => document.querySelector('aside').getBoundingClientRect().width < 100",
            timeout=5_000,
        )


def ensure_l2_open(page) -> None:
    """Expand L1, open the Admin panel, and wait for L2 to become visible."""
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)


def l1_btn(l1, label: str):
    # Sidebar items with routes render as <Link> (role=link); containers render as <button>
    return l1.get_by_role("button", name=label, exact=True).or_(
        l1.get_by_role("link", name=label, exact=True)
    )
