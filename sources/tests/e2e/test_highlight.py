from helpers import nav, ensure_l1_expanded


def test_active_route_highlight(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    ensure_l1_expanded(page, page.locator("aside").first)
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert len(ring_items) > 0, "No ring-primary highlight found"
    assert set(ring_items) == {"Admin", "Theme & Styles"}, \
        f"Expected {{Admin, Theme & Styles}}, got {ring_items}"


def test_usermanagement_highlights_admin_ancestor(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    ensure_l1_expanded(page, page.locator("aside").first)

    # Users lives under Admin: on /user-management the Admin L2 opens automatically and
    # both the Admin ancestor and the active Users item are highlighted.
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert set(ring_items) == {"Admin", "Users"}, \
        f"Expected {{Admin, Users}} on /user-management, got {ring_items}"
