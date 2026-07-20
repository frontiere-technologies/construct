from playwright.sync_api import expect
from helpers import nav

PRIMARY_DEFAULT = '#6366f1'


def _set_color(locator, value):
    locator.evaluate(
        """(el, val) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


def _theme_primary_var(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim()"
    )


def test_theme_buttons_labeled_reset_annulla_salva(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    expect(page.get_by_role("button", name="Reset", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Annulla", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Salva", exact=True)).to_be_visible()


def test_color_change_does_not_apply_until_save(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    original_var = _theme_primary_var(page)
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    _set_color(picker, "#123456")
    expect(picker).to_have_value("#123456")
    assert _theme_primary_var(page) == original_var, "color must not apply live before Save"

    # Cleanup: discard the unsaved edit
    page.get_by_role("button", name="Annulla", exact=True).click()
    expect(picker).to_have_value(original_value)


def test_reset_updates_draft_without_applying(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    original_var = _theme_primary_var(page)
    picker = page.locator('input[type="color"]').first

    page.get_by_role("button", name="Reset", exact=True).click()
    expect(picker).to_have_value(PRIMARY_DEFAULT)
    assert _theme_primary_var(page) == original_var, "Reset must not apply live before Save"

    # Cleanup: discard the reset draft
    page.get_by_role("button", name="Annulla", exact=True).click()


def test_annulla_discards_pending_edits(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    _set_color(picker, "#abcdef")
    expect(picker).to_have_value("#abcdef")

    page.get_by_role("button", name="Annulla", exact=True).click()
    expect(picker).to_have_value(original_value)


def test_save_applies_and_persists_color(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    try:
        _set_color(picker, "#00ff00")
        page.get_by_role("button", name="Salva", exact=True).click()
        page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)

        assert _theme_primary_var(page) == "#00ff00", "Save must apply the color live"

        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.locator('input[type="color"]').first).to_have_value("#00ff00")
    finally:
        # Restore the original color so the test doesn't leak a theme change
        nav(page, f"{base_url}/admin/theme")
        current = page.locator('input[type="color"]').first
        _set_color(current, original_value)
        page.get_by_role("button", name="Salva", exact=True).click()
        page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)
