import re
from playwright.sync_api import expect
from helpers import nav


def _open_column_filter(page, col_id: str):
    """Click the funnel icon on a column header to open its filter popup.

    Note: the installed AG Grid build uses the Theming API (not the legacy
    CSS themes), so the clickable filter icon is `[data-ref="eFilterButton"]`
    (class `ag-header-cell-filter-button`) — the `ag-filter-icon` class only
    marks the (usually hidden) "filter active" indicator, not the button.
    """
    header = page.locator(f'.ag-header-cell[col-id="{col_id}"]')
    header.locator('.ag-header-cell-filter-button').click()


def _rows(page):
    """All data rows in the grid.

    Note: with the Theming API build in use here, rows live directly under
    `.ag-grid-scrolling-rows` — there is no `.ag-center-cols-container`
    wrapper (that class belongs to the legacy CSS theme DOM). Since this
    grid has no pinned columns, `.ag-row` alone is unambiguous.
    """
    return page.locator('.ag-row')


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


def test_non_admin_denied(non_admin_page, base_url):
    nav(non_admin_page, f"{base_url}/user-management")
    expect(non_admin_page.get_by_role("heading", name="Utenti")).to_have_count(0)


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
