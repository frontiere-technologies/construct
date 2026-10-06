import re

import pytest
from playwright.sync_api import expect
from helpers import nav

# Must match DEFAULT_PRIMARY in sources/microservices/web-construct/lib/theme-vars.ts
# and the row seeded by migration 0031. Duplicated because pytest cannot import
# the TypeScript constant; "Valori di Default" is what ties the two together.
PRIMARY_DEFAULT = "#4f46e5"
GREEN = "#059669"
# Already readable on every light surface, so the light variant is the colour itself.
CUSTOM = "#123456"
# A light surface every text level still reads on (faint text stays above 4.5:1): no warning.
READABLE_SURFACE = "#f8fafc"
# A dark surface under the dark text of the light mode: the save asks first.
UNREADABLE_SURFACE = "#1f2937"


def _css_var(page, name):
    return page.evaluate(
        "name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()", name
    )


def _primary_var(page):
    return _css_var(page, "--primary")


def _wait_css_var(page, name, value, *, equal=True, timeout=5_000):
    """Wait until --name on <html> is (or is no longer) value: the live preview is written by a
    React effect after the click, so a one-shot read right after an action can see the old value."""
    page.wait_for_function(
        """([name, value, equal]) => {
            const current = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return equal ? current === value : current !== value;
        }""",
        arg=[name, value, equal],
        timeout=timeout,
    )


def _set_color_input(page, test_id, value):
    page.get_by_test_id(test_id).evaluate(
        """(el, val) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


def _set_custom_color(page, value):
    """The panel's custom colour, for whichever cell is selected (the primary colour on load)."""
    _set_color_input(page, "theme-custom-color", value)


def _select_cell(page, cell):
    """Select a preview cell, e.g. "light-card" or "primary-dark": the panel below then edits it."""
    page.get_by_test_id(f"theme-cell-{cell}").click()
    expect(page.get_by_test_id(f"theme-cell-{cell}")).to_have_attribute("aria-pressed", "true")


def _save(page):
    page.get_by_role("button", name="Salva", exact=True).click()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)


def _save_confirming_warnings(page):
    """Save, and if the contrast warning opens, confirm it: only for putting things back."""
    page.get_by_role("button", name="Salva", exact=True).click()
    saved = page.locator("text=Theme saved.")
    confirm = page.get_by_role("button", name="Salva comunque", exact=True)
    saved.or_(confirm).first.wait_for(state="visible", timeout=10_000)
    if confirm.is_visible():
        confirm.click()
        saved.wait_for(state="visible", timeout=10_000)


def _restore_default(page, base_url):
    """The app theme is global: a test that leaves it changed repaints every later test."""
    nav(page, f"{base_url}/admin/theme")
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    _save_confirming_warnings(page)


def _hex(page):
    return page.get_by_test_id("theme-panel-hex")


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
    # The chosen colour must apply before Save.
    _wait_css_var(page, "--primary", saved, equal=False)
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
    _wait_css_var(page, "--primary", saved)


def test_custom_colour_applies_live(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    _set_custom_color(page, CUSTOM)
    expect(page.get_by_test_id("theme-swatch-custom")).to_have_attribute("aria-checked", "true")
    _wait_css_var(page, "--primary", CUSTOM)


def test_reset_returns_to_the_default(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    page.get_by_test_id("theme-swatch-green").click()
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    expect(page.get_by_test_id("theme-swatch-indigo")).to_have_attribute("aria-checked", "true")
    expect(_hex(page)).to_have_text(re.compile(PRIMARY_DEFAULT, re.I))
    _wait_css_var(page, "--primary", PRIMARY_DEFAULT)


def test_save_persists_after_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        _set_custom_color(page, CUSTOM)
        _save(page)

        nav(page, f"{base_url}/admin/theme")
        expect(_hex(page)).to_have_text(re.compile(CUSTOM, re.I))
        _wait_css_var(page, "--primary", CUSTOM)
    finally:
        _restore_default(page, base_url)


def test_saved_colour_reaches_every_user(logged_in_page, non_admin_page, base_url):
    admin = logged_in_page
    try:
        nav(admin, f"{base_url}/admin/theme")
        _set_custom_color(admin, CUSTOM)
        _save(admin)

        nav(non_admin_page, f"{base_url}/")
        _wait_css_var(non_admin_page, "--primary", CUSTOM)
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


def test_custom_surface_persists_after_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        _select_cell(page, "light-card")
        expect(page.get_by_test_id("theme-panel-title")).to_have_text("Superficie · Chiaro")
        _set_custom_color(page, READABLE_SURFACE)
        expect(page.get_by_test_id("theme-cell-light-card-marker")).to_be_visible()
        _save(page)

        nav(page, f"{base_url}/admin/theme")
        # The browser is in light mode (theme_mode "system", no dark emulation): --card is the light one.
        _wait_css_var(page, "--card", READABLE_SURFACE)
        _wait_css_var(page, "--popover", READABLE_SURFACE)
        expect(page.get_by_test_id("theme-cell-light-card-marker")).to_be_visible()
        expect(page.get_by_test_id("theme-cell-light-card")).to_have_attribute(
            "aria-label", re.compile(rf"^Superficie, chiaro: {READABLE_SURFACE} — personalizzato")
        )
        expect(page.get_by_test_id("theme-cell-dark-card-marker")).to_have_count(0)
    finally:
        _restore_default(page, base_url)


def test_unreadable_surface_asks_before_saving_and_cancel_saves_nothing(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        saved_card = _css_var(page, "--card")
        _select_cell(page, "light-card")
        _set_custom_color(page, UNREADABLE_SURFACE)
        page.get_by_role("button", name="Salva", exact=True).click()

        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible(timeout=10_000)
        expect(dialog).to_contain_text("Alcuni testi si leggono male")
        expect(dialog.get_by_test_id("theme-contrast-warnings").get_by_role("listitem").first).to_contain_text(
            "Superficie"
        )
        expect(dialog.get_by_role("button", name="Salva comunque", exact=True)).to_be_visible()

        dialog.get_by_role("button", name="Annulla", exact=True).click()
        expect(dialog).to_have_count(0)
        expect(page.locator("text=Theme saved.")).to_have_count(0)

        nav(page, f"{base_url}/admin/theme")
        _wait_css_var(page, "--card", saved_card)
        expect(page.get_by_test_id("theme-cell-light-card-marker")).to_have_count(0)
    finally:
        _restore_default(page, base_url)


def test_primary_cell_is_selected_on_load_and_a_surface_switches_the_panel(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    # The two Principale cells are separate targets (DEC-10): only the light one is selected on load.
    expect(page.get_by_test_id("theme-cell-primary-light")).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_test_id("theme-cell-primary-dark")).to_have_attribute("aria-pressed", "false")
    expect(page.locator('[aria-pressed="true"]')).to_have_count(1)
    expect(page.get_by_test_id("theme-panel-title")).to_have_text("Colore principale · Chiaro")
    expect(page.get_by_test_id("theme-swatch-indigo")).to_be_visible()

    _select_cell(page, "dark-sidebar")
    expect(page.get_by_test_id("theme-cell-primary-light")).to_have_attribute("aria-pressed", "false")
    expect(page.get_by_test_id("theme-panel-title")).to_have_text("Sidebar · Scuro")
    for suggestion in ("default", "cool", "warm", "neutral", "tint"):
        expect(page.get_by_test_id(f"theme-swatch-{suggestion}")).to_be_visible()
    expect(page.get_by_test_id("theme-swatch-default")).to_have_attribute("aria-checked", "true")
    # Always there, so the dots do not move; disabled while the cell is on its default.
    expect(page.get_by_test_id("theme-use-default")).to_be_visible()
    expect(page.get_by_test_id("theme-use-default")).to_be_disabled()


def test_suggested_surface_applies_live_and_use_default_resets_it(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    saved_card = _css_var(page, "--card")
    _select_cell(page, "light-card")

    page.get_by_test_id("theme-swatch-cool").click()
    expect(page.get_by_test_id("theme-swatch-cool")).to_have_attribute("aria-checked", "true")
    chosen = page.get_by_test_id("theme-panel-hex").inner_text().strip().lower()
    assert chosen != saved_card
    # The browser is in light mode, so the light --card is the one in use.
    _wait_css_var(page, "--card", chosen)
    expect(page.get_by_test_id("theme-cell-light-card-marker")).to_be_visible()

    expect(page.get_by_test_id("theme-use-default")).to_be_enabled()
    page.get_by_test_id("theme-use-default").click()
    expect(page.get_by_test_id("theme-use-default")).to_be_disabled()
    expect(page.get_by_test_id("theme-cell-light-card-marker")).to_have_count(0)
    expect(page.get_by_test_id("theme-swatch-default")).to_have_attribute("aria-checked", "true")
    _wait_css_var(page, "--card", saved_card)


def test_dark_primary_saved_applies_in_dark_mode_only(logged_in_page, browser, base_url, admin_storage_state):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        _select_cell(page, "primary-dark")
        expect(page.locator('[aria-pressed="true"]')).to_have_count(1)
        expect(page.get_by_test_id("theme-panel-title")).to_have_text("Colore principale · Scuro")
        expect(page.get_by_test_id("theme-swatch-auto")).to_have_attribute("aria-checked", "true")
        # The green preset made readable on the dark palette: the dark mode shows it as it is.
        page.get_by_test_id("theme-swatch-green").click()
        expect(page.get_by_test_id("theme-swatch-green")).to_have_attribute("aria-checked", "true")
        chosen = page.get_by_test_id("theme-panel-hex").inner_text().strip().lower()
        expect(page.get_by_test_id("theme-cell-primary-dark-marker")).to_be_visible()
        expect(page.get_by_test_id("theme-use-default")).to_be_enabled()
        _save(page)

        # The fixture user follows the system (theme_mode "system"): a dark context puts html.dark on.
        dark_ctx = browser.new_context(
            viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state, color_scheme="dark"
        )
        try:
            dark = dark_ctx.new_page()
            nav(dark, f"{base_url}/admin/theme")
            dark.wait_for_function("document.documentElement.classList.contains('dark')", timeout=5_000)
            _wait_css_var(dark, "--primary", chosen)
            expect(dark.get_by_test_id("theme-cell-primary-dark-marker")).to_be_visible()
        finally:
            dark_ctx.close()

        # The light mode keeps its own primary colour.
        nav(page, f"{base_url}/admin/theme")
        _wait_css_var(page, "--primary", PRIMARY_DEFAULT)
    finally:
        _restore_default(page, base_url)


def _overlaps(a, b):
    return a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] \
        and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]


@pytest.mark.parametrize("width", [825, 375])
def test_theme_page_fits_a_narrow_card(logged_in_page, base_url, width):
    """With the sidebar open the card is far narrower than the window: the six dots, the hex and
    "Usa il predefinito" used to stay on one line beside the hint, squeezing it to zero width under them;
    the preview cells shrank until their names were cut, and Salva stuck out of the card."""
    page = logged_in_page
    page.set_viewport_size({"width": width, "height": 900})
    nav(page, f"{base_url}/admin/theme")
    hint = page.get_by_test_id("theme-panel-hint")
    controls = page.get_by_test_id("theme-panel-controls")
    expect(controls).to_be_visible()

    hint_box, controls_box = hint.bounding_box(), controls.bounding_box()
    assert hint_box["width"] > 100, f"the hint is squeezed to {hint_box['width']}px"
    assert not _overlaps(hint_box, controls_box), "the colour dots cover the hint"
    for test_id in ("theme-swatch-custom", "theme-panel-hex", "theme-use-default"):
        right = page.get_by_test_id(test_id).bounding_box()
        assert right["x"] + right["width"] <= controls_box["x"] + controls_box["width"] + 1, \
            f"{test_id} sticks out of the panel at {width}px"

    truncated = page.evaluate(
        """() => [...document.querySelectorAll('[data-testid^="theme-cell-"]')]
            .filter(c => c.scrollWidth > c.clientWidth).map(c => c.dataset.testid)"""
    )
    assert truncated == [], f"preview cells cut at {width}px: {truncated}"
    sticking_out = page.evaluate(
        """() => {
            const card = document.querySelector('[data-testid="theme-panel-hint"]').closest('.bg-card')
            const right = card.getBoundingClientRect().right
            return [...card.querySelectorAll('button')]
                .filter(b => b.getBoundingClientRect().right > right + 1).map(b => b.textContent.trim())
        }"""
    )
    assert sticking_out == [], f"buttons sticking out of the card at {width}px: {sticking_out}"
