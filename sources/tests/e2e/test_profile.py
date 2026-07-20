import pytest
from helpers import nav, ensure_l1_expanded


@pytest.fixture
def profile_page(logged_in_page, base_url):
    nav(logged_in_page, f"{base_url}/profile")
    return logged_in_page


def test_profile_navigation_from_sidebar(logged_in_page, test_email):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)

    l1.locator(f"button:has-text('{test_email}')").click()
    page.locator("aside").nth(1).wait_for(state="visible", timeout=5_000)
    page.locator("aside").nth(1).get_by_text("Profile").click()
    page.wait_for_url("**/profile", timeout=10_000)
    assert "/profile" in page.url


def test_profile_email_is_readonly(profile_page):
    email_input = profile_page.locator('input[type="email"]')
    assert email_input.is_visible(), "Email input not visible"
    assert not email_input.is_enabled(), "Email input should be read-only"


def test_profile_has_editable_fields(profile_page):
    editable = profile_page.locator('input[type="text"], input[type="tel"]')
    count = editable.count()
    assert count >= 4, f"Expected ≥4 editable fields, got {count}"


def test_profile_save_and_persist(profile_page, base_url):
    page = profile_page

    first_name_input = page.locator('input[type="text"]').first
    first_name_input.fill("E2E Test User")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded_value = page.locator('input[type="text"]').first.input_value()
    assert reloaded_value == "E2E Test User", f"Value not persisted after reload: '{reloaded_value}'"

    # Cleanup
    page.locator('input[type="text"]').first.fill("")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)


def test_profile_phone_rejects_invalid_format(profile_page):
    page = profile_page

    phone_input = page.locator('input[type="tel"]')
    phone_input.fill("123")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Numero di telefono non valido").wait_for(state="visible", timeout=10_000)

    # Cleanup: field is unsaved, but clear the input for test isolation
    phone_input.fill("")


def test_profile_phone_accepts_e164_format(profile_page):
    page = profile_page

    phone_input = page.locator('input[type="tel"]')
    phone_input.fill("+14155552671")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded_value = page.locator('input[type="tel"]').input_value()
    assert reloaded_value == "+14155552671", f"Value not persisted after reload: '{reloaded_value}'"

    # Cleanup
    page.locator('input[type="tel"]').fill("")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)


def test_profile_phone_trims_whitespace_on_persist(profile_page):
    page = profile_page

    phone_input = page.locator('input[type="tel"]')
    # Submit a whitespace-padded valid E.164 number
    phone_input.fill("  +14155552671  ")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded_value = page.locator('input[type="tel"]').input_value()
    # Assert the persisted value is trimmed, not the padded original
    assert reloaded_value == "+14155552671", f"Phone number not trimmed on persist: '{reloaded_value}'"

    # Cleanup
    page.locator('input[type="tel"]').fill("")
    page.get_by_role("button", name="Salva").click()
    page.locator("text=Profile saved.").wait_for(state="visible", timeout=10_000)


def test_profile_annulla_discards_changes(profile_page):
    page = profile_page
    first_name_input = page.locator('input[type="text"]').first
    original_value = first_name_input.input_value()

    first_name_input.fill("Should Not Persist")
    page.get_by_role("button", name="Annulla").click()

    assert first_name_input.input_value() == original_value

    page.reload()
    page.wait_for_load_state("networkidle")
    reloaded = page.locator('input[type="text"]').first.input_value()
    assert reloaded == original_value, "Annulla must not persist the discarded value"
