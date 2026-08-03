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


def test_theme_buttons_labeled_default_values_salva(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Salva", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Annulla", exact=True)).to_have_count(0)


def test_color_change_applies_live_before_save(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    try:
        _set_color(picker, "#123456")
        expect(picker).to_have_value("#123456")
        assert _theme_primary_var(page) == "#123456", "color must apply live before Save"
    finally:
        # Cleanup: restore the original color without persisting the edit
        _set_color(picker, original_value)


def test_reset_updates_and_applies_default_values(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    try:
        page.get_by_role("button", name="Valori di Default", exact=True).click()
        expect(picker).to_have_value(PRIMARY_DEFAULT)
        assert _theme_primary_var(page) == PRIMARY_DEFAULT, "Reset must apply live"
    finally:
        # Cleanup: restore the original color without persisting the edit
        _set_color(picker, original_value)


def test_save_persists_color(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    picker = page.locator('input[type="color"]').first
    original_value = picker.input_value()

    try:
        _set_color(picker, "#00ff00")
        page.get_by_role("button", name="Salva", exact=True).click()
        page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)

        assert _theme_primary_var(page) == "#00ff00"

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


def test_inputs_disabled_while_saving(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    # Keep the browser-side server-action request pending long enough to observe
    # the transient busy state even when the local/CI database responds within
    # a single Playwright polling interval.
    page.evaluate(
        """() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 750));
                return originalFetch(...args);
            };
        }"""
    )
    picker = page.locator('input[type="color"]').first
    page.get_by_role("button", name="Salva", exact=True).click()
    expect(picker).to_be_disabled()
    expect(page.locator('input[type="color"]').nth(1)).to_be_disabled()
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_disabled()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)
    expect(picker).to_be_enabled()
    expect(page.locator('input[type="color"]').nth(1)).to_be_enabled()
