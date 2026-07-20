import re
import time
from datetime import date, timedelta

from playwright.sync_api import expect
from helpers import nav, open_column_filter as _open_column_filter, grid_rows as _rows


def _search(page, base_url, name):
    """Filter the Roles grid by name via the `description` column's text filter."""
    nav(page, f"{base_url}/roles-permissions")
    _open_column_filter(page, "description")
    page.locator('.ag-filter input[type="text"]').first.fill(name)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")


def _create_role(page, base_url, name):
    """Create a SERVICE role; lands on its detail page. Returns the detail URL."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Salva").click()
    # Higher timeout: first hit to the detail route triggers Next.js dev-mode compilation (~3-5s)
    page.wait_for_url("**/roles-permissions/**", timeout=15_000)
    return page.url


def _delete_role(page, base_url, name):
    """Delete a role via the column filter + row menu, then assert it's gone."""
    _search(page, base_url, name)
    row = _rows(page).filter(has_text=name)
    expect(row).to_be_visible()
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    _search(page, base_url, name)
    expect(_rows(page).filter(has_text=name)).to_have_count(0)


def test_roles_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    expect(page.get_by_role("heading", name="Ruoli & permessi")).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="description"]')).to_be_visible()
    expect(page.locator('.ag-header-cell[col-id="hasPermissions"]')).to_be_visible()
    # Administrator (id 1) is seeded and must appear
    expect(page.get_by_text("Administrator", exact=True).first).to_be_visible()


def test_create_rename_delete_role(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Role {int(time.time())}"
    _create_role(page, base_url, name)
    assert name in page.inner_text("h1")

    # Rename via the pencil (SERVICE roles are renamable)
    renamed = name + " R"
    page.get_by_test_id("rename-role-btn").click()
    page.get_by_placeholder("Nome ruolo").fill(renamed)
    page.get_by_role("button", name="Salva").click()
    # Wait for the heading to reflect the rename (retrying assertion)
    expect(page.locator("h1")).to_contain_text(renamed)

    _delete_role(page, base_url, renamed)


def test_toggle_permission_persists(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Perm {int(time.time())}"
    detail_url = _create_role(page, base_url, name)

    page.get_by_role("button", name="Modifica").click()
    page.locator('[data-testid="perm-toggle"]').first.click()
    page.get_by_role("button", name="Salva").click()

    # Wait for save to complete: edit mode exits → "Modifica" button reappears
    page.get_by_role("button", name="Modifica").wait_for(state="visible", timeout=10_000)

    # Reload and assert at least one permission toggle is ON
    nav(page, detail_url)
    page.wait_for_selector('[data-testid="perm-toggle"][aria-checked="true"]', timeout=10_000)
    expect(page.locator('[data-testid="perm-toggle"][aria-checked="true"]').first).to_be_visible()

    # Cleanup: delete the role this test created (avoid leaking E2E roles into the DB)
    _delete_role(page, base_url, name)


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions/1")  # Administrator = SYSTEM
    edit = page.get_by_role("button", name="Modifica")
    expect(edit).to_be_disabled()


def test_filter_by_creation_date_range(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E DateFilter {int(time.time())}"
    _create_role(page, base_url, name)

    _search(page, base_url, name)
    expect(_rows(page).filter(has_text=name)).to_have_count(1)

    _open_column_filter(page, "dateIns")
    # AG Grid's date filter renders two native <input type="date"> fields (from/to).
    # The column is configured with filterOptions ['inRange']/defaultOption 'inRange',
    # so AG Grid only considers the filter model complete (and fires filterChanged)
    # once BOTH bounds are set — filling only "from" leaves the filter inactive.
    # Note: AG Grid also requires dateFrom to be strictly earlier than dateTo — using
    # today for both bounds leaves the (custom) Applica button permanently disabled,
    # so use today..tomorrow (the role created above still falls inside that range).
    date_inputs = page.locator('.ag-filter input[type="date"]')
    today = date.today()
    tomorrow = today + timedelta(days=1)
    date_inputs.nth(0).fill(today.strftime("%Y-%m-%d"))
    date_inputs.nth(1).fill(tomorrow.strftime("%Y-%m-%d"))
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")

    # The role we just created was created today, so it must still match the range
    expect(_rows(page).filter(has_text=name)).to_have_count(1)
    expect(page).to_have_url(re.compile("startDateIns="))
    expect(page).to_have_url(re.compile("endDateIns="))

    _delete_role(page, base_url, name)


def test_filter_by_has_permission_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    rows = _rows(page)
    baseline = rows.count()
    assert baseline > 0
    assert page.get_by_text("Sì", exact=True).count() > 0

    _open_column_filter(page, "hasPermissions")
    page.get_by_test_id("filter-option-false").click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile("hasPermission=false"))
    # Every visible row must now be a role without permissions: the "Sì" badge
    # (shown only for hasPermissions=true) must not appear among the rows.
    # Scoped to `rows` (not a page-wide get_by_text): unlike the Users grid's
    # status/roles EnumSelectFilter popups (which auto-close once their filter
    # is applied — apparently because the resulting row-count change triggers
    # a grid scroll/reflow that AG Grid's popup service treats as "click
    # outside"), this filter's popup stays open after selecting an option, and
    # its own unselected "Sì" option button (labelled identically to the row
    # badge) would otherwise be a false positive for an unscoped text search.
    expect(rows.first).to_be_visible()
    expect(rows.get_by_text("Sì", exact=True)).to_have_count(0)

    _open_column_filter(page, "hasPermissions")
    page.get_by_text("Tutti", exact=True).click()
    page.wait_for_load_state("networkidle")
    expect(page).not_to_have_url(re.compile("hasPermission="))
    expect(rows).to_have_count(baseline)


def test_column_visibility_toggle(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    expect(page.locator('.ag-header-cell[col-id="dateMod"]')).to_be_visible()
    page.get_by_role("button", name="Colonne").click()
    # Scoped via the checkbox's implicit <label>: the column header also
    # renders the literal text "Ultimo aggiornamento", so an unscoped
    # get_by_text would be ambiguous (strict-mode violation).
    page.get_by_label("Ultimo aggiornamento", exact=True).click()
    expect(page.locator('.ag-header-cell[col-id="dateMod"]')).to_have_count(0)
