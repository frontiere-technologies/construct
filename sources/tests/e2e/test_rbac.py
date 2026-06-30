import pytest
from helpers import nav

RBAC_ROUTES = ["/user-management", "/functionalities", "/roles-permissions"]


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_unauthenticated_redirect(page, base_url, route):
    nav(page, f"{base_url}{route}")
    assert "/login" in page.url, f"Expected redirect to /login from {route}, got {page.url}"


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_non_admin_redirected(non_admin_page, base_url, route):
    nav(non_admin_page, f"{base_url}{route}")
    assert route not in non_admin_page.url, f"Non-admin should not reach {route}, got {non_admin_page.url}"


def test_admin_not_locked_out(logged_in_page, base_url):
    """Admin still reaches the app root and sees the sidebar (no lock-out after migration)."""
    nav(logged_in_page, f"{base_url}/")
    assert "/login" not in logged_in_page.url
    # Sidebar renders the user account row
    assert logged_in_page.locator('[data-testid="sidebar-toggle"]').count() >= 1
