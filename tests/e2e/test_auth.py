def test_unauthenticated_redirect_to_login(page, base_url):
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


def test_login_page_shows_sign_in_buttons(page, base_url):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    assert page.locator('button:has-text("Sign in with Microsoft")').is_visible()
    assert page.locator('button:has-text("Sign in with Google")').is_visible()
    assert page.locator('button:has-text("Sign in with Keycloak")').is_visible()


def test_test_login_redirects_to_home(page, base_url, test_email):
    """Verifies the test credentials flow works end-to-end."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[placeholder="Test email"]', test_email)
    page.click('button:has-text("Test Login")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    assert page.url == f"{base_url}/", f"Expected {base_url}/, got {page.url}"


def test_authenticated_login_redirects_to_home(logged_in_page, base_url):
    """Already-authenticated user visiting /login is redirected to /."""
    logged_in_page.goto(f"{base_url}/login")
    logged_in_page.wait_for_load_state("networkidle")
    assert logged_in_page.url == f"{base_url}/", f"Expected {base_url}/, got {logged_in_page.url}"
