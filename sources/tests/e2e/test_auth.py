from helpers import nav, do_test_login


def test_unauthenticated_redirect_to_login(page, base_url):
    nav(page, base_url)
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


def test_login_page_shows_sign_in_buttons(page, base_url):
    nav(page, f"{base_url}/login")
    assert page.locator('input[type="email"]').is_visible()
    assert page.locator('input[type="password"]').is_visible()
    assert page.locator('button[type="submit"]:has-text("Accedi")').is_visible()
    assert page.locator('button:has-text("Continua con Google")').is_visible()


def test_test_login_redirects_to_home(page, base_url, test_email):
    """Verifies the test credentials flow works end-to-end (do_test_login asserts the redirect to /)."""
    do_test_login(page, base_url, test_email)


def test_authenticated_login_redirects_to_home(logged_in_page, base_url):
    """Already-authenticated user visiting /login is redirected to /."""
    nav(logged_in_page, f"{base_url}/login")
    assert logged_in_page.url == f"{base_url}/", f"Expected {base_url}/, got {logged_in_page.url}"
