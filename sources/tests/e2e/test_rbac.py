import os
import pytest

RBAC_ROUTES = ["/userManagement", "/functionalities", "/rolesPermissions"]


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_unauthenticated_redirect(page, base_url, route):
    page.goto(f"{base_url}{route}")
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login from {route}, got {page.url}"


@pytest.fixture
def non_admin_user_email():
    email = os.getenv("TEST_EMAIL_USER", "")
    if not email:
        pytest.skip("Set TEST_EMAIL_USER in .env.test to run non-admin RBAC tests")
    return email


@pytest.fixture
def non_admin_page(page, base_url, non_admin_user_email):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('button:has-text("Accesso test")')
    page.fill('input[placeholder="Email di test"]', non_admin_user_email)
    page.click('button:has-text("Entra (test)")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    page.wait_for_load_state("networkidle")
    yield page


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_non_admin_redirected(non_admin_page, base_url, route):
    non_admin_page.goto(f"{base_url}{route}")
    non_admin_page.wait_for_load_state("networkidle")
    assert route not in non_admin_page.url, f"Non-admin should not reach {route}, got {non_admin_page.url}"


def test_admin_not_locked_out(logged_in_page, base_url):
    """Admin still reaches the app root and sees the sidebar (no lock-out after migration)."""
    logged_in_page.goto(f"{base_url}/")
    logged_in_page.wait_for_load_state("networkidle")
    assert "/login" not in logged_in_page.url
    # Sidebar renders the user account row
    assert logged_in_page.locator('[data-testid="sidebar-toggle"]').count() >= 1
