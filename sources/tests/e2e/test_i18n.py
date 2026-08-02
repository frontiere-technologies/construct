import subprocess
import time
from pathlib import Path

import pytest
from playwright.sync_api import expect
from helpers import nav, do_test_login, switch_language, grid_rows as _rows, open_column_filter


REPO_ROOT = Path(__file__).resolve().parents[3]


def _open_translations(page, base_url):
    nav(page, f"{base_url}/admin/translations")
    # Bilingual on purpose: some tests reach this helper again from inside a
    # `finally` cleanup block *after* switching the page to English mid-test,
    # so the heading may legitimately read "Translations" instead of
    # "Traduzioni" at that point.
    heading = page.get_by_role("heading", name="Traduzioni").or_(
        page.get_by_role("heading", name="Translations"))
    expect(heading).to_be_visible()


def _filter_by_key(page, key):
    """Filter the translations grid by the `key` column's text filter."""
    open_column_filter(page, "key")
    page.locator('.ag-filter input[type="text"]').first.fill(key)
    apply_btn = page.get_by_role("button", name="Applica").or_(
        page.get_by_role("button", name="Apply"))
    apply_btn.click()
    page.wait_for_load_state("networkidle")


def _restore_save_translation(page, base_url) -> None:
    """Best-effort: put common.actions.save's English value back to "Save".

    `common.actions.save` backs nearly every Save button in the app, so a
    marker value left behind by a crashed test would cascade into unrelated
    E2E assertions across the whole suite, the same way a stuck language
    preference does. This is deliberately bilingual (the page may be in
    Italian or English depending on where the calling test got to) and
    swallows its own failures so a broken cleanup never masks the real
    assertion error raised by the test body — the module-level DB safety net
    below is the last resort if this can't run at all.
    """
    try:
        _open_translations(page, base_url)
        _filter_by_key(page, "common.actions.save")
        _rows(page).first.locator('[data-testid^="row-menu"]').click()
        edit_btn = page.get_by_role("button", name="Modifica").or_(
            page.get_by_role("button", name="Edit"))
        edit_btn.click()
        editor = page.locator('[data-testid="translation-editor"]')
        editor.locator('[data-testid="translation-value-en"]').fill("Save")
        save_btn = editor.get_by_role("button", name="Salva").or_(
            editor.get_by_role("button", name="Save"))
        save_btn.click()
        expect(editor).to_be_hidden(timeout=10_000)
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[test_i18n cleanup] failed to restore common.actions.save: {exc}")


def _safe_switch_language(page, code: str) -> None:
    try:
        switch_language(page, code)
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[test_i18n cleanup] failed to switch language to {code!r}: {exc}")


def _delete_translation_key(page, base_url, key) -> None:
    try:
        _open_translations(page, base_url)
        _filter_by_key(page, key)
        rows = _rows(page)
        if rows.count() == 0:
            return
        rows.first.locator('[data-testid^="row-menu"]').click()
        page.get_by_role("button", name="Elimina").click()  # row-menu item -> opens ConfirmModal
        page.get_by_role("button", name="Elimina").click()  # ConfirmModal's confirm button
        page.wait_for_load_state("networkidle")
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[test_i18n cleanup] failed to delete translation key {key!r}: {exc}")


def _delete_language(page, base_url, native_name) -> None:
    try:
        nav(page, f"{base_url}/admin/languages")
        row = _rows(page).filter(has_text=native_name)
        if row.count() == 0:
            return
        row.locator('[data-testid^="row-menu"]').click()
        page.get_by_role("button", name="Elimina").click()  # row-menu item -> opens ConfirmModal
        page.get_by_role("button", name="Elimina").click()  # ConfirmModal's confirm button
        page.wait_for_load_state("networkidle")
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[test_i18n cleanup] failed to delete language {native_name!r}: {exc}")


def _restore_i18n_content() -> None:
    """Module-level DB safety net, mirroring conftest's clean_language_preferences.

    Per-test try/finally blocks (above) are the primary cleanup mechanism, but
    a test that crashes badly enough to break even its own `finally` (e.g. the
    browser context itself dies) can still leave `common.actions.save`'s
    English value, a half-created `nl` language row, or a `zzz_e2e.*` scratch
    key behind. This runs once after the whole module, independent of the UI,
    so the rest of the suite (and a re-run of this file) is never left
    poisoned by this file's own content.
    """
    subprocess.run(
        ["node", "sources/devops/db/db.mjs", "test-query",
         "update translation_value set value = 'Save' "
         "from translation_key, app_language "
         "where translation_value.id_translation_key = translation_key.id_translation_key "
         "and translation_value.id_language = app_language.id_language "
         "and translation_key.key = 'common.actions.save' and app_language.code = 'en'; "
         "delete from app_language where code = 'nl'; "
         "delete from translation_key where namespace = 'zzz_e2e';"],
        cwd=REPO_ROOT, check=False, capture_output=True,
    )


@pytest.fixture(scope="module", autouse=True)
def _i18n_content_safety_net():
    yield
    _restore_i18n_content()


# ---------------------------------------------------------------- §18.1

def test_admin_edits_a_translation_and_the_user_sees_it(logged_in_page, base_url):
    page = logged_in_page
    marker = f"Save {int(time.time())}"

    try:
        _open_translations(page, base_url)
        _filter_by_key(page, "common.actions.save")
        row = _rows(page).first
        row.locator('[data-testid^="row-menu"]').click()
        page.get_by_role("button", name="Modifica").click()

        editor = page.locator('[data-testid="translation-editor"]')
        expect(editor).to_be_visible()
        editor.locator('[data-testid="translation-value-en"]').fill(marker)
        editor.get_by_role("button", name="Salva").click()
        expect(editor).to_be_hidden(timeout=10_000)

        # The new English value must be visible without a re-login.
        switch_language(page, "en")
        nav(page, f"{base_url}/profile")
        expect(page.get_by_role("button", name=marker)).to_be_visible()
    finally:
        # Restore, so the suite stays re-runnable and the Italian assertions
        # elsewhere hold, regardless of where the test above failed.
        _restore_save_translation(page, base_url)
        _safe_switch_language(page, "it")


def test_language_choice_survives_logout_and_login(browser, base_url, test_email):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        do_test_login(page, base_url, test_email)
        switch_language(page, "en")
        nav(page, f"{base_url}/profile")
        expect(page.get_by_role("button", name="Save")).to_be_visible()

        page.locator('[data-testid="sidebar-account-button"]').click()
        page.get_by_role("button", name="Logout").click()
        page.wait_for_url(f"{base_url}/login", timeout=15_000)

        do_test_login(page, base_url, test_email)
        nav(page, f"{base_url}/profile")
        expect(page.get_by_role("button", name="Save")).to_be_visible()
    finally:
        _safe_switch_language(page, "it")
        ctx.close()


def test_a_missing_english_translation_falls_back_to_italian(logged_in_page, base_url):
    page = logged_in_page
    key = f"zzz_e2e.fallback_{int(time.time())}"

    try:
        _open_translations(page, base_url)
        page.get_by_role("button", name="Nuova chiave").click()
        page.get_by_label("Chiave").fill(key)
        page.get_by_label("Namespace").fill("zzz_e2e")
        page.get_by_role("button", name="Salva").click()
        page.wait_for_load_state("networkidle")

        _filter_by_key(page, key)
        _rows(page).first.locator('[data-testid^="row-menu"]').click()
        page.get_by_role("button", name="Modifica").click()
        editor = page.locator('[data-testid="translation-editor"]')
        editor.locator('[data-testid="translation-value-it"]').fill("Valore italiano")
        # English intentionally left empty.
        editor.get_by_role("button", name="Salva").click()
        expect(editor).to_be_hidden(timeout=10_000)

        # The grid marks it missing in English…
        _filter_by_key(page, key)
        expect(_rows(page).first).to_contain_text("Mancante")

        # …and the API serves the Italian value as the English fallback.
        response = page.request.get(f"{base_url}/api/i18n/dictionary?code=en")
        assert response.ok
        assert key not in response.json()["dictionary"]
    finally:
        _delete_translation_key(page, base_url, key)


def test_non_admin_cannot_reach_the_i18n_configuration(non_admin_page, base_url):
    page = non_admin_page
    nav(page, f"{base_url}/admin/translations")
    expect(page).to_have_url(f"{base_url}/")
    nav(page, f"{base_url}/admin/languages")
    expect(page).to_have_url(f"{base_url}/")

    for path in ("/api/i18n/translations-grid", "/api/i18n/languages-grid"):
        response = page.request.post(f"{base_url}{path}", data={"page": 0, "size": 10})
        assert response.status == 403, f"{path} returned {response.status}"


# ---------------------------------------------------------------- §18.2

def test_deactivating_a_language_removes_it_from_the_switcher(logged_in_page, base_url):
    page = logged_in_page
    code = "nl"

    try:
        nav(page, f"{base_url}/admin/languages")
        page.get_by_role("button", name="Nuova lingua").click()
        page.get_by_label("Codice").fill(code)
        page.get_by_label("Locale").fill("nl-NL")
        page.get_by_label("Nome", exact=True).fill("Dutch")
        page.get_by_label("Nome nativo").fill("Nederlands")
        page.get_by_role("button", name="Salva").click()
        # `wait_for_load_state("networkidle")` is a no-op here: no top-level
        # navigation has happened since the `nav()` above, so Playwright
        # considers "networkidle" already reached and returns immediately —
        # it does NOT wait for the createLanguage() server action's request to
        # finish. Waiting for the new row instead proves the write has
        # actually committed before the `page.reload()` below fires a fresh
        # SSR read; without it, the reload can race the INSERT and come back
        # with only `en`/`it`, intermittently failing the switcher assertion.
        expect(_rows(page).filter(has_text="Nederlands")).to_be_visible(timeout=10_000)

        page.reload()
        page.wait_for_load_state("networkidle")
        page.locator('[data-testid="sidebar-account-button"]').click()
        page.locator('[data-testid="language-switcher"]').click()
        expect(page.locator(f'[data-testid="language-option-{code}"]')).to_be_visible()
        page.keyboard.press("Escape")
        # Escape only closes the language-switcher listbox itself (its own
        # `open` state) — the account/user panel opened above stays open.
        # `sidebar-account-button` toggles that panel, so `switch_language()`
        # below would otherwise close it instead of opening it, hiding
        # `language-switcher` and timing out. Close it explicitly first to
        # restore the closed baseline `switch_language()` assumes.
        page.locator('[data-testid="sidebar-account-button"]').click()

        # A user who had picked it falls back to the default once it is deactivated.
        switch_language(page, code)
        nav(page, f"{base_url}/admin/languages")
        row = _rows(page).filter(has_text="Nederlands")
        row.locator('[data-testid^="row-menu"]').click()
        page.get_by_role("button", name="Disattiva").click()
        # Same `wait_for_load_state("networkidle")` no-op as above: it would
        # return immediately without waiting for `setLanguageActive()`'s
        # request to land. Wait for the grid's own "Attiva" cell to actually
        # flip to "No" — proof the mutation committed — before the `nav()`
        # below fires a fresh SSR read that must see it deactivated.
        expect(row.locator('.ag-cell[col-id="isActive"]')).to_have_text("No", timeout=10_000)

        nav(page, f"{base_url}/profile")
        expect(page.get_by_role("button", name="Salva")).to_be_visible()   # back to Italian
        page.locator('[data-testid="sidebar-account-button"]').click()
        page.locator('[data-testid="language-switcher"]').click()
        expect(page.locator(f'[data-testid="language-option-{code}"]')).to_have_count(0)
        page.keyboard.press("Escape")
    finally:
        # Deleting the language also clears any lingering `users.id_language`
        # FK reference to it (ON DELETE SET NULL), so this alone restores both
        # the languages table and the profile's effective language.
        _delete_language(page, base_url, "Nederlands")


# ---------------------------------------------------------------- §18.3

def test_concurrent_edits_are_detected_instead_of_overwritten(browser, base_url, admin_storage_state):
    """Two admins open the same translation; the second save must be refused."""
    ctx_a = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state)
    ctx_b = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state)
    page_a, page_b = ctx_a.new_page(), ctx_b.new_page()
    winner = f"Winner {int(time.time())}"

    try:
        for page in (page_a, page_b):
            _open_translations(page, base_url)
            _filter_by_key(page, "common.actions.save")
            _rows(page).first.locator('[data-testid^="row-menu"]').click()
            page.get_by_role("button", name="Modifica").click()
            expect(page.locator('[data-testid="translation-editor"]')).to_be_visible()

        editor_a = page_a.locator('[data-testid="translation-editor"]')
        editor_a.locator('[data-testid="translation-value-en"]').fill(winner)
        editor_a.get_by_role("button", name="Salva").click()
        expect(editor_a).to_be_hidden(timeout=10_000)

        editor_b = page_b.locator('[data-testid="translation-editor"]')
        editor_b.locator('[data-testid="translation-value-en"]').fill("Loser")
        editor_b.get_by_role("button", name="Salva").click()

        expect(page_b.locator('[data-testid="translation-conflict"]')).to_be_visible(timeout=10_000)
        expect(page_b.locator('[data-testid="translation-conflict"]')).to_contain_text(winner)

        # The first admin's value is still what is stored.
        response = page_a.request.get(f"{base_url}/api/i18n/dictionary?code=en")
        assert response.json()["dictionary"]["common.actions.save"] == winner
    finally:
        # Restore.
        _restore_save_translation(page_a, base_url)
        ctx_a.close()
        ctx_b.close()
