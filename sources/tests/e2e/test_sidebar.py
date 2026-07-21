from helpers import ensure_l1_expanded, ensure_l1_collapsed, ensure_l2_open, l1_btn


def test_l1_sidebar_visible(logged_in_page):
    l1 = logged_in_page.locator("aside").first
    assert l1.is_visible()


def test_l1_has_buttons(logged_in_page):
    l1 = logged_in_page.locator("aside").first
    btn_count = l1.locator("button").count()
    assert btn_count >= 3, f"Expected ≥3 buttons, got {btn_count}"


def test_l1_expands(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    w_collapsed = l1.bounding_box()["width"]
    ensure_l1_expanded(page, l1)
    w_expanded = l1.bounding_box()["width"]
    assert w_expanded > w_collapsed, f"L1 did not expand: {w_collapsed:.0f}px → {w_expanded:.0f}px"


def test_l1_shows_menu_labels(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    assert l1_btn(l1, "Home").is_visible()
    assert l1_btn(l1, "Admin").is_visible()


def test_sidebar_persists_after_navigation(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    # Users now lives under the Admin L2 panel
    ensure_l2_open(page)
    l2 = page.locator("aside").nth(1)
    l2.get_by_role("link", name="Users", exact=True).or_(
        l2.get_by_role("button", name="Users", exact=True)
    ).click()
    page.wait_for_url("**/user-management", timeout=5_000)
    assert l1.is_visible(), "Sidebar not visible after navigation"
    assert l1.bounding_box()["width"] >= 100, "L1 collapsed after navigation"


def test_admin_opens_l2(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    aside_count = page.locator("aside").count()
    assert aside_count >= 2, f"Expected ≥2 aside columns, got {aside_count}"


def test_l2_shows_admin_items(logged_in_page):
    page = logged_in_page
    ensure_l2_open(page)
    l2 = page.locator("aside").nth(1)
    assert l2.get_by_text("Theme & Styles").is_visible()


def test_l2_navigation_users(logged_in_page):
    page = logged_in_page
    # Users now lives under the Admin L2 panel
    ensure_l2_open(page)
    l2 = page.locator("aside").nth(1)
    l2.get_by_role("link", name="Users", exact=True).or_(
        l2.get_by_role("button", name="Users", exact=True)
    ).click()
    page.wait_for_url("**/user-management", timeout=5_000)
    assert "/user-management" in page.url


def test_l2_navigation_theme(logged_in_page):
    page = logged_in_page
    ensure_l2_open(page)
    page.locator("aside").nth(1).get_by_text("Theme & Styles").click()
    page.wait_for_url("**/admin/theme", timeout=5_000)
    assert "/admin/theme" in page.url


def test_admin_closes_l2_on_second_click(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l2_open(page)
    assert page.locator("aside").count() >= 2, "L2 did not open"
    l1_btn(l1, "Admin").click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length < 2",
        timeout=5_000,
    )
    assert page.locator("aside").count() < 2, "L2 did not close after second click"


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


def test_l1_collapses(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    w_before = l1.bounding_box()["width"]
    ensure_l1_collapsed(page, l1)
    w_after = l1.bounding_box()["width"]
    assert w_after < w_before, f"L1 did not collapse: {w_before:.0f}px → {w_after:.0f}px"


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


def test_narrow_viewport_forces_col1_icons(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    assert l1.bounding_box()["width"] >= 100, "L1 was not in text mode before narrowing"

    page.set_viewport_size({"width": 600, "height": 900})
    page.wait_for_function(
        "() => document.querySelector('aside').getBoundingClientRect().width < 100",
        timeout=5_000,
    )
    assert l1.bounding_box()["width"] < 100, "L1 did not force icon mode below 768px"
    assert l1.locator('[data-testid="sidebar-toggle"]').count() == 0, "Toggle should not render below 768px"

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_function(
        "() => document.querySelector('aside').getBoundingClientRect().width >= 100",
        timeout=5_000,
    )
    assert l1.bounding_box()["width"] >= 100, "L1 did not restore saved (text) preference above 768px"
    assert l1.locator('[data-testid="sidebar-toggle"]').is_visible()


def test_narrow_viewport_forces_col2_icons(logged_in_page):
    page = logged_in_page
    ensure_l2_open(page)
    l2 = page.locator("aside").nth(1)
    assert l2.bounding_box()["width"] >= 100, "L2 was not in text mode before narrowing"

    page.set_viewport_size({"width": 600, "height": 900})
    page.wait_for_function(
        "() => document.querySelectorAll('aside')[1].getBoundingClientRect().width < 100",
        timeout=5_000,
    )
    assert l2.bounding_box()["width"] < 100, "L2 did not force icon mode below 768px"

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_function(
        "() => document.querySelectorAll('aside')[1].getBoundingClientRect().width >= 100",
        timeout=5_000,
    )
    assert l2.bounding_box()["width"] >= 100, "L2 did not restore saved (text) preference above 768px"


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


def test_hover_preview_shows_master_toggle(logged_in_page):
    # The master-collapse button ("Collassa menu") is harmless to show inside
    # the hover preview: clicking it just re-asserts masterCollapsed(true),
    # which is already true there, so there's no need to hide it.
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
    assert preview.locator('[data-testid="sidebar-master-toggle"]').count() == 1, \
        "Master-collapse toggle should still appear inside the hover preview overlay"


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

    # The top-level nav items rendered here are DB-driven and, depending on
    # menu content, may all be containers (no directly navigable link at that
    # level) — so reach a link via the account button, which is always
    # present in col1 and always reveals a real "Profile" link in col2. This
    # keeps the test independent of what the current menu happens to contain.
    # Uses the stable testid rather than "last button in the aside": since
    # Task 2 moved col1's ColToggleStack (with its own toggle button) to
    # render after the account button in the DOM, "last button" no longer
    # reliably identifies the account button.
    preview.locator("aside").first.locator('[data-testid="sidebar-account-button"]').click()
    link = preview.locator("a").first
    link.wait_for(state="visible", timeout=2_000)

    url_before = page.url
    link.click()
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


def test_hover_preview_does_not_reopen_instantly_after_pin_and_recollapse(logged_in_page):
    # Regression test for: hoverPreviewOpen was only ever reset on pathname
    # change or the mouse-leave debounce path, never when masterCollapsed
    # transitioned from true -> false. Repro:
    #   1. Collapse the rail, hover it -> preview opens after the 180ms debounce.
    #   2. Click the rail's own button to pin the sidebar expanded
    #      (setMasterCollapsed(false)). React unmounts the rail out from under
    #      the cursor, so no real mouseleave ever fires on it.
    #   3. Re-collapse via the master-toggle button inside the expanded columns.
    #   4. Because hoverPreviewOpen was never cleared in step 2, the overlay's
    #      render condition (masterCollapsed && hoverPreviewOpen) is instantly
    #      true again -- the overlay pops open with no fresh hover and no
    #      180ms debounce, violating the hover-intent debounce requirement.
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

    # Pin the sidebar expanded by clicking the rail's own button -- not a
    # mouseleave -- exactly as described in the bug repro.
    page.locator('[data-testid="sidebar-collapsed-rail"]').click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"sidebar-collapsed-rail\"]') === null"
        " && document.querySelector('[data-testid=\"sidebar-master-toggle\"]') !== null",
        timeout=5_000,
    )

    # Move the mouse away from where the (now-unmounted) rail used to be, so
    # nothing in this test itself could trigger a fresh, legitimate hover.
    page.mouse.move(800, 450)

    # Re-collapse via the master-toggle button inside the pinned/expanded columns.
    # Note: we wait for the rail button to reappear (a reliable masterCollapsed
    # === true signal), rather than for the aside count to drop to 1 -- if the
    # bug is present, the stale hoverPreviewOpen state also keeps the portaled
    # preview (with its own <aside> columns) mounted, so the total aside count
    # would never reach 1 even though the collapse itself succeeded.
    # Note: deliberately do NOT move the mouse again after this click. Clicking
    # the button leaves the cursor resting exactly where the button was, which
    # is where the rail's own button subsequently renders (both are bottom-
    # anchored in the same narrow column) -- mirroring the real scenario where
    # the user's cursor doesn't move away right after the click that collapsed
    # it. Moving the mouse away here would trigger a legitimate mouseleave on
    # the freshly-mounted rail and mask the bug via the correct close-debounce
    # path instead of exercising the stale-state reset this test targets.
    l1_expanded = page.locator("aside").first
    l1_expanded.locator('[data-testid="sidebar-master-toggle"]').click()
    page.locator('[data-testid="sidebar-collapsed-rail"]').wait_for(state="visible", timeout=5_000)

    # Give it well past the 180ms open-debounce window and assert the overlay
    # never appears without a fresh hover.
    page.wait_for_timeout(300)
    assert not preview.is_visible(), (
        "Hover preview reopened instantly after re-collapsing without a fresh "
        "hover -- stale hoverPreviewOpen state was not cleared when pinning "
        "(masterCollapsed: true -> false)"
    )
