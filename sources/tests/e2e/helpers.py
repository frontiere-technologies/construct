from playwright.sync_api import expect


def nav(page, url: str) -> None:
    """Navigate to a URL and wait until React event handlers are attached."""
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.wait_for_function(
        "document.documentElement.dataset.appHydrated === 'true'",
        timeout=15_000,
    )


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
    wrapper (that class belongs to the legacy CSS theme DOM).

    `.ag-row` stays unambiguous even though the actions column is pinned left:
    this AG Grid version keeps pinned and scrolling cells inside the *same* row
    element (the legacy DOM used to duplicate each row per pinned container), so
    there is one `.ag-row` per record and the row-menu button is inside it.
    """
    return page.locator('.ag-row')


def do_test_login(page, base_url: str, email: str) -> None:
    """Authenticate via the test-credentials form (requires AUTH_TEST_CREDENTIALS=true on server).

    Locale-tolerant: the /login page normally renders in Italian (the app's
    default), but a language-switch cookie from earlier in the same browser
    context (e.g. a prior `switch_language(page, "en")` followed by logout)
    can make it render in English instead. Every other test in this suite
    only ever hits `/login` fresh, where the default locale always holds —
    this is the one place a mid-session language switch can precede a login,
    so each step matches either language's copy (same `.or_()` pattern used
    for the Salva/Save buttons elsewhere in this suite).
    """
    nav(page, f"{base_url}/login")
    page.get_by_role("button", name="Accesso test").or_(
        page.get_by_role("button", name="Test login")
    ).click()
    page.get_by_placeholder("Email di test").or_(
        page.get_by_placeholder("Test email")
    ).fill(email)
    page.get_by_role("button", name="Entra (test)").or_(
        page.get_by_role("button", name="Sign in (test)")
    ).click()
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
    # Centre the target before measuring: dnd-kit auto-scrolls when the pointer nears the
    # scroll container's edge, which slides the row out from under the pointer mid-drag, so
    # `over` becomes null and no drop indicator is ever rendered. A row visible but close to
    # the bottom of the window is enough to trigger it once the tree has a dozen-odd rows.
    tgt.evaluate("e => e.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(150)
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


def switch_language(page, code: str) -> None:
    """Open the sidebar account panel and pick a language by its code.

    The switcher lives in the account panel, which is only rendered once the
    panel is open, and the sidebar's first column may be collapsed to icons.

    Waits for the switch to actually land, not for the network to go quiet.
    `wait_for_load_state("networkidle")` was the previous signal and it is the
    wrong one here: choosing a language calls `setLanguage()`, which runs
    `setPreferredLanguage()` inside a React `startTransition`, so the request is
    issued *after* the click handler returns. networkidle is evaluated against
    the state at the moment it is called — the page is already loaded and quiet
    — so it resolved instantly, before the server action had been issued. When
    the caller was a cleanup step at the end of a test, the fixture then closed
    the browser context and killed the request: the language stayed on the
    previous choice, the server never logged a `setPreferredLanguage` call, and
    every later test in the run rendered in the wrong language.

    The trigger renders the current language's native name, so that text is the
    signal that the round trip finished and the RSC tree re-rendered. It is read
    from the option itself instead of being mapped from the code, so this stays
    correct for any language the suite adds.
    """
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    page.locator('[data-testid="sidebar-account-button"]').click()
    switcher = page.locator('[data-testid="language-switcher"]')
    switcher.click()
    option = page.locator(f'[data-testid="language-option-{code}"]')
    native_name = option.inner_text().strip()
    option.click()
    expect(switcher).to_contain_text(native_name, timeout=15_000)
    # The trigger is `disabled` for as long as `isSwitching` is true; waiting for it
    # to come back confirms the transition committed rather than merely started.
    expect(switcher).to_be_enabled(timeout=15_000)
