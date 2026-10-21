import os
import re
import subprocess
from pathlib import Path
from playwright.sync_api import expect
from helpers import nav, open_column_filter as _open_column_filter, grid_rows as _rows, confirm_modal


def test_users_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    expect(page.get_by_role("heading", name="Utenti")).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="status"]')).to_be_visible()
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()


def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    before = _rows(page).count()
    _open_column_filter(page, "firstName")
    page.locator('.ag-filter input[type="text"]').first.fill("zzz-no-such-user-zzz")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    after = _rows(page).count()
    assert after <= before


def test_manage_roles_opens_and_lists_roles(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    # The actions column is the first column and pinned left, so it is always
    # within the viewport — no scrolling needed to reach the row menu.
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()
    reg = page.get_by_test_id("role-checkbox-0")
    expect(reg).to_be_disabled()


def test_filter_by_status_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    rows = _rows(page)
    baseline = rows.count()
    assert page.get_by_text("Attivo", exact=True).count() > 0

    _open_column_filter(page, "status")
    page.get_by_test_id("filter-option-1").click()  # 1 = Disattivato
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("statuses=1"))
    expect(page.get_by_text("Attivo", exact=True)).to_have_count(0)
    # The disposable seed may legitimately contain no deactivated users. The
    # URL and absence of active rows still prove that the filter was applied;
    # reset below proves that the original data is restored.
    assert rows.count() <= baseline

    _open_column_filter(page, "status")
    page.get_by_text("Tutti", exact=True).click()
    page.wait_for_load_state("networkidle")
    expect(page).not_to_have_url(re.compile("statuses="))
    expect(page.get_by_text("Attivo", exact=True).first).to_be_visible()
    expect(rows).to_have_count(baseline)


def test_filter_by_role(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    rows = _rows(page)
    baseline = rows.count()
    assert baseline > 0
    assert rows.filter(has_text="Administrator").count() < baseline

    _open_column_filter(page, "roles")
    page.get_by_test_id("filter-option-1").click()  # 1 = Administrator
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("roleIds=1"))
    expect(rows.first).to_be_visible()
    # Every visible row must carry the Administrator role: none should lack it.
    # (Comparing against a `rows.count()` snapshot taken *before* the retrying
    # expect() is flaky: that count is evaluated once, synchronously, and can
    # capture the grid mid-refetch — e.g. "1" row visible transiently — instead
    # of the settled total.)
    expect(rows.filter(has_not_text="Administrator")).to_have_count(0)


def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    _open_column_filter(page, "dateIns")
    # AG Grid's date filter renders two native <input type="date"> fields (from/to).
    # The column is configured with filterOptions ['inRange']/defaultOption 'inRange',
    # so AG Grid only considers the filter model complete (and fires filterChanged)
    # once BOTH bounds are set — filling only "from" leaves the filter inactive.
    date_inputs = page.locator('.ag-filter input[type="date"]')
    date_inputs.nth(0).fill("2000-01-01")
    date_inputs.nth(1).fill("2026-12-31")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("createdFrom="))
    expect(page).to_have_url(re.compile("createdTo="))


def test_status_toggle_updates_grid_in_place(logged_in_page, base_url):
    """Covers the 88abae4 fix: toggling a user's status must refresh the AG Grid
    row via gridApi.refreshInfiniteCache() alone, with no page navigation/reload.
    Scopes assertions to the row's own `row-id` attribute (the user's id) rather
    than "some badge somewhere", and asserts the URL never changes, so this test
    would fail if the refreshInfiniteCache() call were removed from toggleStatus.

    The toggle now lives in the row's "..." actions menu (not a click on the
    badge itself), so each flip is driven through that menu.
    """
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    url_before = page.url

    row = _rows(page).first
    row_id = row.get_attribute("row-id")
    badge = row.locator('[data-testid="status-badge"]')
    original_text = badge.inner_text()
    assert original_text in ("Attivo", "Disattivato")
    flipped_text = "Disattivato" if original_text == "Attivo" else "Attivo"

    # Re-locate the row by its stable row-id after each toggle: refreshInfiniteCache()
    # refetches the current blocks, which can reorder rows, but the same user id
    # must still be present with the flipped status — without any navigation.
    row_by_id = page.locator(f'.ag-row[row-id="{row_id}"]')

    def _toggle_via_menu(expected_menu_label):
        row_by_id.locator('[data-testid^="row-menu"]').click()
        # The status toggle stopped using a native confirm() on 2026-09-02: it
        # now opens this project's ConfirmModal, whose confirm button reuses the
        # same label as the row-menu item. Since 2026-09-07 the two no longer
        # share a role either: the row menu is a real ARIA menu, so the item is
        # a "menuitem" and only the dialog holds a "button" with that label.
        page.get_by_role("menuitem", name=expected_menu_label).click()  # menu item -> ConfirmModal
        confirm_modal(page, expected_menu_label)

    _toggle_via_menu("Disattiva" if original_text == "Attivo" else "Attiva")
    expect(row_by_id.locator('[data-testid="status-badge"]')).to_have_text(flipped_text)
    expect(page).to_have_url(url_before)

    # Restore original state so the test doesn't leave data mutated.
    _toggle_via_menu("Disattiva" if flipped_text == "Attivo" else "Attiva")
    expect(row_by_id.locator('[data-testid="status-badge"]')).to_have_text(original_text)
    expect(page).to_have_url(url_before)


def test_actions_column_header_is_empty_and_has_no_divider(logged_in_page, base_url):
    """The icon-only actions column has no redundant text label or divider."""
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    actions_header = page.locator('.ag-header-cell[col-id="actions"]')
    expect(actions_header).to_have_text("")

    assert actions_header.evaluate("el => getComputedStyle(el, '::after').display") == "none", \
        "The actions column must not draw a divider against the first text column"

    other_divider = page.locator('.ag-header-cell[col-id="email"]').evaluate(
        "el => getComputedStyle(el, '::after').borderRightColor"
    )
    assert other_divider != "rgba(0, 0, 0, 0)", \
        "Non-actions columns lost their header divider"


def test_actions_column_stays_pinned_on_horizontal_scroll(logged_in_page, base_url):
    """The actions column is pinned left: scrolling the grid horizontally moves
    the other columns only, keeping the row menu reachable at all times."""
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    actions_header = page.locator('.ag-header-cell[col-id="actions"]')
    first_menu = page.locator('[data-testid^="row-menu"]').first
    expect(actions_header).to_be_visible()

    x_before = actions_header.bounding_box()["x"]
    email_x_before = page.locator('.ag-header-cell[col-id="email"]').bounding_box()["x"]

    page.evaluate(
        """() => {
            const v = document.querySelector('.ag-body-horizontal-scroll-viewport');
            v.scrollLeft = v.scrollWidth;
        }"""
    )
    # The scroll is applied on the next animation frame, so wait for the
    # scrolling columns to have actually moved before comparing positions.
    page.wait_for_function(
        """x => {
            const h = document.querySelector('.ag-header-cell[col-id="email"]');
            return !h || h.getBoundingClientRect().x < x;
        }""",
        arg=email_x_before,
    )

    assert actions_header.bounding_box()["x"] == x_before, \
        "The pinned actions column moved while scrolling horizontally"
    expect(first_menu).to_be_visible()


def test_column_visibility_toggle(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_be_visible()
    page.get_by_role("button", name="Colonne").click()
    # Scoped via the checkbox's implicit <label>: the column header also
    # renders the literal text "Email", so an unscoped get_by_text would be
    # ambiguous (strict-mode violation).
    page.get_by_label("Email", exact=True).click()
    expect(page.locator('.ag-header-cell[col-id="email"]')).to_have_count(0)


REPO_ROOT = Path(__file__).resolve().parents[3]
DONE = "Persona aggiunta o invitata."


def _delete_user(email: str) -> None:
    """Cancella l'account con quell'email dal database di prova (lo stesso comando di conftest)."""
    subprocess.run(
        ["node", "sources/devops/db/db.mjs", "test-delete-user"],
        cwd=REPO_ROOT, check=True, capture_output=True, env={**os.environ, "E2E_REGISTER_EMAIL": email},
    )


def _add_person(page, email: str) -> None:
    page.get_by_role("button", name="Aggiungi persona", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_label("Email", exact=True).fill(email)
    dialog.get_by_role("button", name="Aggiungi", exact=True).click()
    # Per un account nuovo l'azione aspetta il provider dell'email (secondi, non millisecondi).
    expect(dialog.get_by_role("status")).to_have_text(DONE, timeout=30_000)
    dialog.get_by_role("button", name="Chiudi", exact=True).click()
    expect(dialog).to_have_count(0)


def test_add_person_by_email(logged_in_page, base_url, registration_email):
    """MT2-OK-1: l'amministratore aggiunge una persona per email; compare tra gli utenti con stato
    Attivo, e ripetere l'aggiunta dà lo stesso esito neutro (nessun secondo account)."""
    page = logged_in_page
    _delete_user(registration_email)
    try:
        nav(page, f"{base_url}/user-management")
        _add_person(page, registration_email)

        # La griglia si è aggiornata da sola: filtrando per l'email la riga c'è, ed è attiva.
        _open_column_filter(page, "email")
        page.locator('.ag-filter input[type="text"]').first.fill(registration_email)
        page.get_by_role("button", name="Applica").click()
        row = _rows(page).filter(has_text=registration_email)
        expect(row).to_have_count(1)
        expect(row.locator('[data-testid="status-badge"]')).to_have_text("Attivo")

        # Ripetuta (anche con maiuscole e spazi attorno): stesso messaggio, ancora una sola riga.
        _add_person(page, f"  {registration_email.upper()} ")
        expect(_rows(page).filter(has_text=registration_email)).to_have_count(1)
    finally:
        _delete_user(registration_email)
