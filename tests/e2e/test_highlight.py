from helpers import ensure_l1_expanded, l1_btn


def test_active_route_highlight(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")
    ensure_l1_expanded(page, page.locator("aside").first)
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert len(ring_items) > 0, "No ring-primary highlight found"
    assert set(ring_items) == {"Admin", "Menu Builder"}, \
        f"Expected {{Admin, Menu Builder}}, got {ring_items}"


def test_no_double_highlight_on_support_with_admin_open(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/support")
    page.wait_for_load_state("networkidle")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)

    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert ring_items == ["Support"], f"Expected ['Support'] on /support, got {ring_items}"

    l1_btn(l1, "Admin").click()
    page.wait_for_timeout(400)
    ring_after = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert ring_after == ["Support"], \
        f"Double highlight regression: expected ['Support'], got {ring_after}"
