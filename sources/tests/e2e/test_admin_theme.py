import re

from playwright.sync_api import expect
from helpers import nav

# Must match DEFAULT_PRIMARY in sources/microservices/web-construct/lib/theme-vars.ts
# and the row seeded by migration 0031. Duplicated because pytest cannot import
# the TypeScript constant; "Valori di Default" is what ties the two together.
PRIMARY_DEFAULT = "#4f46e5"
GREEN = "#059669"
# Already readable on every light surface, so the light variant is the colour itself.
CUSTOM = "#123456"


def _primary_var(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()"
    )


def _set_custom_color(page, value):
    page.locator('[data-testid="theme-custom-color"]').evaluate(
        """(el, val) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


def _save(page):
    page.get_by_role("button", name="Salva", exact=True).click()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)


def _restore_default(page, base_url):
    """The app colour is global: a test that leaves it changed repaints every later test."""
    nav(page, f"{base_url}/admin/theme")
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    _save(page)


def _hex(page):
    return page.get_by_test_id("theme-primary-hex")


def test_theme_buttons_labeled_default_values_salva(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Salva", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Annulla", exact=True)).to_have_count(0)


def test_swatch_applies_live_and_is_dropped_on_leaving(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    saved = _primary_var(page)

    page.get_by_test_id("theme-swatch-green").click()
    expect(page.get_by_test_id("theme-swatch-green")).to_have_attribute("aria-checked", "true")
    expect(_hex(page)).to_have_text(re.compile(GREEN, re.I))
    assert _primary_var(page) != saved, "the chosen colour must apply before Save"
    assert page.locator("#app-primary-preview").count() == 1, "the preview is a <style> element"

    # Leaving by a client-side navigation (no reload) runs the unmount cleanup:
    # the preview element goes away and the saved colour shows again.
    page.evaluate("window.__stayedInTheSameDocument = true")
    # The Admin panel (second sidebar column) is already open on /admin/theme, because the
    # sidebar opens the panels leading to the current page: clicking "Admin" would close it.
    l2 = page.locator("aside").nth(1)
    l2.get_by_role("link", name="Gestione utenti", exact=True).or_(
        l2.get_by_role("button", name="Gestione utenti", exact=True)
    ).click()
    page.wait_for_url("**/user-management", timeout=5_000)
    assert page.evaluate("window.__stayedInTheSameDocument === true"), "must be a client-side navigation"
    expect(page.locator("#app-primary-preview")).to_have_count(0)
    assert _primary_var(page) == saved


def test_custom_colour_applies_live(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    _set_custom_color(page, CUSTOM)
    expect(page.get_by_test_id("theme-swatch-custom")).to_have_attribute("aria-checked", "true")
    assert _primary_var(page) == CUSTOM


def test_reset_returns_to_the_default(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    page.get_by_test_id("theme-swatch-green").click()
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    expect(page.get_by_test_id("theme-swatch-indigo")).to_have_attribute("aria-checked", "true")
    expect(_hex(page)).to_have_text(re.compile(PRIMARY_DEFAULT, re.I))
    assert _primary_var(page) == PRIMARY_DEFAULT


def test_save_persists_after_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        _set_custom_color(page, CUSTOM)
        _save(page)

        nav(page, f"{base_url}/admin/theme")
        expect(_hex(page)).to_have_text(re.compile(CUSTOM, re.I))
        assert _primary_var(page) == CUSTOM
    finally:
        _restore_default(page, base_url)


def test_saved_colour_reaches_every_user(logged_in_page, non_admin_page, base_url):
    admin = logged_in_page
    try:
        nav(admin, f"{base_url}/admin/theme")
        _set_custom_color(admin, CUSTOM)
        _save(admin)

        nav(non_admin_page, f"{base_url}/")
        assert _primary_var(non_admin_page) == CUSTOM
    finally:
        _restore_default(admin, base_url)


def test_controls_disabled_while_saving(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    # Keep the server-action request pending long enough to observe the busy state.
    page.evaluate(
        """() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 750));
                return originalFetch(...args);
            };
        }"""
    )
    swatch = page.get_by_test_id("theme-swatch-green")
    page.get_by_role("button", name="Salva", exact=True).click()
    expect(swatch).to_be_disabled()
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_disabled()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)
    expect(swatch).to_be_enabled()
