from helpers import ensure_l1_expanded, l1_btn


def test_active_route_highlight(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/admin/theme")
    page.wait_for_load_state("networkidle")
    ensure_l1_expanded(page, page.locator("aside").first)
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert len(ring_items) > 0, "No ring-primary highlight found"
    assert set(ring_items) == {"Admin", "Theme & Styles"}, \
        f"Expected {{Admin, Theme & Styles}}, got {ring_items}"


def test_no_double_highlight_on_usermanagement_with_admin_open(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)

    # On /userManagement the RBAC L2 opens automatically; RBAC and Users are highlighted
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert set(ring_items) == {"RBAC", "Users"}, \
        f"Expected {{RBAC, Users}} on /userManagement, got {ring_items}"

    # Open Admin L2 — a different panel that has no relationship to the active route
    l1_btn(l1, "Admin").click()
    page.wait_for_timeout(400)
    ring_after = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    # Opening Admin panel must not add a spurious highlight to Admin items;
    # only the RBAC ancestor should remain highlighted (Users is in RBAC L2 which is now hidden)
    assert "Admin" not in ring_after, \
        f"Spurious Admin highlight regression: got {ring_after}"
    assert "RBAC" in ring_after, \
        f"RBAC ancestor highlight must persist: got {ring_after}"
