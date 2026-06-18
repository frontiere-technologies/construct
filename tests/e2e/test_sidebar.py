from helpers import ensure_l1_expanded, ensure_l1_collapsed, l1_btn


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
    assert l1_btn(l1, "Support").is_visible()
    assert l1_btn(l1, "Admin").is_visible()


def test_support_navigation(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Support").click()
    page.wait_for_url("**/support", timeout=5_000)
    assert "/support" in page.url


def test_sidebar_persists_after_navigation(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Support").click()
    page.wait_for_url("**/support", timeout=5_000)
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
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    l2 = page.locator("aside").nth(1)
    l2.wait_for(state="visible", timeout=5_000)
    assert l2.get_by_text("Menu Builder").is_visible()
    assert l2.get_by_text("Theme & Styles").is_visible()


def test_l2_navigation_menu_builder(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    page.locator("aside").nth(1).get_by_text("Menu Builder").click()
    page.wait_for_url("**/admin/menu-builder", timeout=5_000)
    assert "/admin/menu-builder" in page.url


def test_l2_navigation_theme(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    page.locator("aside").nth(1).get_by_text("Theme & Styles").click()
    page.wait_for_url("**/admin/theme", timeout=5_000)
    assert "/admin/theme" in page.url


def test_admin_closes_l2_on_second_click(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, "Admin").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    assert page.locator("aside").count() >= 2, "L2 did not open"
    l1_btn(l1, "Admin").click()
    page.wait_for_function(
        "() => document.querySelectorAll('aside').length < 2",
        timeout=5_000,
    )
    assert page.locator("aside").count() < 2, "L2 did not close after second click"


def test_l1_collapses(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    w_before = l1.bounding_box()["width"]
    ensure_l1_collapsed(page, l1)
    w_after = l1.bounding_box()["width"]
    assert w_after < w_before, f"L1 did not collapse: {w_before:.0f}px → {w_after:.0f}px"
