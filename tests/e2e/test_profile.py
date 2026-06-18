from helpers import ensure_l1_expanded


def test_profile_navigation_from_sidebar(logged_in_page, credentials):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)

    l1.locator(f"button:has-text('{credentials['email']}')").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    page.locator("aside").nth(1).get_by_text("Profile").click()
    page.wait_for_url("**/profile", timeout=10_000)
    assert "/profile" in page.url


def test_profile_email_is_readonly(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/profile")
    page.wait_for_load_state("networkidle")
    email_input = page.locator('input[type="email"]')
    assert email_input.is_visible(), "Email input not visible"
    assert not email_input.is_enabled(), "Email input should be read-only"


def test_profile_has_editable_fields(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/profile")
    page.wait_for_load_state("networkidle")
    editable = page.locator('input[type="text"], input[type="tel"]')
    count = editable.count()
    assert count >= 4, f"Expected ≥4 editable fields, got {count}"


def test_profile_save_and_persist(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/profile")
    page.wait_for_load_state("networkidle")

    first_name_input = page.locator('input[type="text"]').first
    first_name_input.fill("E2E Test User")
    page.get_by_role("button", name="Save Profile").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)
    assert page.locator("text=Profile saved.").is_visible(), "Save confirmation not shown"

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded_value = page.locator('input[type="text"]').first.input_value()
    assert reloaded_value == "E2E Test User", f"Value not persisted after reload: '{reloaded_value}'"

    # Cleanup
    page.locator('input[type="text"]').first.fill("")
    page.get_by_role("button", name="Save Profile").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)
