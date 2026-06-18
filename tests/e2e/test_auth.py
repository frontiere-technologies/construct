def test_unauthenticated_redirect_to_login(page, base_url):
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login, got {page.url}"


def test_login_redirects_to_home(page, base_url, credentials):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[type="email"]', credentials["email"])
    page.fill('input[type="password"]', credentials["password"])
    page.click('button[type="submit"]')
    page.wait_for_url(f"{base_url}/", timeout=10_000)
    assert page.url == f"{base_url}/", f"Expected {base_url}/, got {page.url}"
