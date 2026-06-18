import os
import pytest


def test_unauthenticated_redirect_from_admin_menu_builder(page, base_url):
    """Unauthenticated requests to /admin/menu-builder must redirect to /login."""
    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


def test_unauthenticated_redirect_from_admin_theme(page, base_url):
    """Unauthenticated requests to /admin/theme must redirect to /login."""
    page.goto(f"{base_url}/admin/theme")
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


@pytest.fixture
def non_admin_credentials():
    email = os.getenv("TEST_EMAIL_USER", "")
    password = os.getenv("TEST_PASSWORD_USER", "")
    if not email or not password:
        pytest.skip("Set TEST_EMAIL_USER and TEST_PASSWORD_USER in .env.test to run non-admin RBAC tests")
    return {"email": email, "password": password}


@pytest.fixture
def non_admin_page(page, base_url, non_admin_credentials):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[type="email"]', non_admin_credentials["email"])
    page.fill('input[type="password"]', non_admin_credentials["password"])
    page.click('button[type="submit"]')
    page.wait_for_url(f"{base_url}/", timeout=10_000)
    page.wait_for_load_state("networkidle")
    yield page


def test_non_admin_redirect_from_admin_menu_builder(non_admin_page, base_url):
    """Non-admin users accessing /admin/menu-builder must be redirected away."""
    non_admin_page.goto(f"{base_url}/admin/menu-builder")
    non_admin_page.wait_for_load_state("networkidle")
    assert "/admin/menu-builder" not in non_admin_page.url, \
        f"Non-admin user should not access /admin/menu-builder, got {non_admin_page.url}"


def test_non_admin_redirect_from_admin_theme(non_admin_page, base_url):
    """Non-admin users accessing /admin/theme must be redirected away."""
    non_admin_page.goto(f"{base_url}/admin/theme")
    non_admin_page.wait_for_load_state("networkidle")
    assert "/admin/theme" not in non_admin_page.url, \
        f"Non-admin user should not access /admin/theme, got {non_admin_page.url}"
