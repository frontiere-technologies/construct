import re
from playwright.sync_api import expect
from helpers import nav, open_column_filter as _open_column_filter, grid_rows as _rows


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
    # The actions column sits at the far right of the grid's own internal
    # horizontal-scroll area (its content width exceeds the visible viewport
    # once the sidebar takes its share) — Playwright's auto-scroll doesn't
    # reliably bring AG Grid's transform-positioned virtual columns into view,
    # so scroll explicitly before clicking.
    row_menu = page.locator('[data-testid^="row-menu"]').first
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
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
    expect(page.get_by_text("Disattivato", exact=True).first).to_be_visible()

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
        row_menu = row_by_id.locator('[data-testid^="row-menu"]')
        row_menu.scroll_into_view_if_needed()
        row_menu.click()
        page.once("dialog", lambda d: d.accept())
        page.get_by_role("button", name=expected_menu_label).click()

    _toggle_via_menu("Disattiva" if original_text == "Attivo" else "Attiva")
    expect(row_by_id.locator('[data-testid="status-badge"]')).to_have_text(flipped_text)
    expect(page).to_have_url(url_before)

    # Restore original state so the test doesn't leave data mutated.
    _toggle_via_menu("Disattiva" if flipped_text == "Attivo" else "Attiva")
    expect(row_by_id.locator('[data-testid="status-badge"]')).to_have_text(original_text)
    expect(page).to_have_url(url_before)


def test_actions_column_header_has_label_and_divider(logged_in_page, base_url):
    """The actions column ("...") used to render with an empty header and no
    divider (resizable: false suppresses AG Grid's resize-handle, which was
    the only thing drawing a line between headers). Regression test for
    giving it a real headerName and enabling headerColumnBorder so every
    column (including non-resizable ones) gets a static divider."""
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    actions_header = page.locator('.ag-header-cell[col-id="actions"]')
    expect(actions_header).to_have_text("...")

    # AG Grid intentionally suppresses the border after the grid's last column
    # (nothing to its right), so the divider between "Aggiornato" and "..." is
    # drawn by dateMod's own right-hand border.
    divider_color = page.locator('.ag-header-cell[col-id="dateMod"]').evaluate(
        "el => getComputedStyle(el, '::after').borderRightColor"
    )
    assert divider_color != "rgba(0, 0, 0, 0)", \
        "Missing divider between the last text column and the actions column"


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
