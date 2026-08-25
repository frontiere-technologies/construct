from helpers import nav, ensure_l1_expanded, l1_btn


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
    # both the Admin ancestor and the active Users item (rendered as "Gestione
    # utenti" in the app's Italian default locale) are highlighted.
    ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
    assert set(ring_items) == {"Admin", "Gestione utenti"}, \
        f"Expected {{Admin, Gestione utenti}} on /user-management, got {ring_items}"


def test_open_section_is_not_highlighted_as_active(logged_in_page, base_url):
    """A section that is merely expanded must not carry the active-page ring: the ring means
    "this is the page you're on" (or a section holding it), an open panel gets a softer fill."""
    page = logged_in_page
    # /profile is a real page that lives outside the menu tree, so no menu entry is active.
    # Scoped to `aside` throughout: the profile form itself uses ring-primary utilities.
    nav(page, f"{base_url}/profile")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    assert page.locator("aside [class*='ring-primary']").count() == 0, \
        "Nothing should carry the active ring while no menu route is open"

    admin = l1_btn(l1, "Admin")
    admin.click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)

    ring_items = [el.inner_text().strip() for el in page.locator("aside [class*='ring-primary']").all()]
    assert ring_items == [], f"An expanded section must not be ringed, got {ring_items}"
    assert "bg-sidebar-accent/50" in (admin.get_attribute("class") or ""), \
        "The expanded section should get the softer open fill"
