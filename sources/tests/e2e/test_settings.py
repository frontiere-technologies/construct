from contextlib import contextmanager

from playwright.sync_api import expect
from helpers import nav


@contextmanager
def _server_action(page):
    """Wait for the server action the block triggers, not for networkidle.

    The settings page applies a choice to the DOM at once and saves it after,
    so a DOM assertion passes before the save has landed. The POST carrying the
    `next-action` header is the signal that the round trip finished.
    """
    with page.expect_response(
        lambda r: r.request.method == "POST" and "next-action" in r.request.headers,
        timeout=15_000,
    ):
        yield


def _is_dark(page):
    return page.evaluate("document.documentElement.classList.contains('dark')")


def _font_size(page):
    return page.evaluate("document.documentElement.style.fontSize")


def _choose_mode(page, label):
    item = page.get_by_role("radio", name=label, exact=True)
    if item.get_attribute("aria-checked") == "true":
        return
    with _server_action(page):
        item.click()


def _restore(page, base_url):
    """Mode and text size live on the profile: leaving them changed alters every later test."""
    nav(page, f"{base_url}/settings")
    _choose_mode(page, "Automatico")
    # One step at a time, each awaited: a key that does not move the value fires
    # no server action, so waiting for one after it would hang until the timeout.
    current = int(_font_size(page).rstrip("%") or "100")
    if current != 100:
        page.get_by_role("slider").focus()
    while current != 100:
        key = "ArrowLeft" if current > 100 else "ArrowRight"
        with _server_action(page):
            page.keyboard.press(key)
        current += -10 if key == "ArrowLeft" else 10
    assert _font_size(page) == "100%"


def test_settings_is_linked_from_the_user_panel(logged_in_page, base_url):
    page = logged_in_page
    page.locator('[data-testid="sidebar-account-button"]').click()
    panel = page.locator("#sidebar-user-panel")
    expect(panel.locator('[data-testid="language-switcher"]')).to_have_count(0)
    expect(panel.get_by_role("switch")).to_have_count(0)
    panel.get_by_role("link", name="Impostazioni").click()
    page.wait_for_url("**/settings", timeout=10_000)
    expect(page.get_by_role("heading", name="Impostazioni")).to_be_visible()


def test_light_and_dark_survive_a_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/settings")
        _choose_mode(page, "Scuro")
        assert _is_dark(page)
        nav(page, f"{base_url}/settings")
        assert _is_dark(page), "dark must be rendered from the profile, not restored by the client"

        _choose_mode(page, "Chiaro")
        assert not _is_dark(page)
        nav(page, f"{base_url}/settings")
        assert not _is_dark(page)
    finally:
        _restore(page, base_url)


def test_automatic_follows_the_operating_system(browser, base_url, admin_storage_state):
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        storage_state=admin_storage_state,
        color_scheme="dark",
    )
    page = ctx.new_page()
    try:
        nav(page, f"{base_url}/settings")
        _choose_mode(page, "Chiaro")
        _choose_mode(page, "Automatico")
        assert _is_dark(page)
        page.emulate_media(color_scheme="light")
        page.wait_for_function("!document.documentElement.classList.contains('dark')", timeout=5_000)
    finally:
        _restore(page, base_url)
        ctx.close()


def test_text_size_scales_and_survives_a_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/settings")
        thumb = page.get_by_role("slider")
        thumb.focus()
        with _server_action(page):
            page.keyboard.press("ArrowRight")
        assert _font_size(page) == "110%"
        nav(page, f"{base_url}/")
        assert _font_size(page) == "110%"
    finally:
        _restore(page, base_url)
