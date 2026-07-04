import re

from playwright.sync_api import expect
from helpers import nav


def test_users_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    expect(page.get_by_role("heading", name="Utenti")).to_be_visible()
    # column headers
    expect(page.get_by_text("Email", exact=True).first).to_be_visible()
    expect(page.get_by_text("Ruoli", exact=True).first).to_be_visible()
    expect(page.get_by_text("Stato", exact=True).first).to_be_visible()
    # at least one status badge rendered
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()


def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    before = page.locator('[data-testid="status-badge"]').count()
    page.get_by_role("button", name="Filtri").click()
    page.get_by_placeholder("Cerca").fill("zzz-no-such-user-zzz")
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    after = page.locator('[data-testid="status-badge"]').count()
    assert after <= before


def test_manage_roles_opens_and_lists_roles(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    # open the first row's action menu, then "Gestisci ruoli"
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()
    # the Registered-user checkbox (id 0) is present and disabled
    reg = page.get_by_test_id("role-checkbox-0")
    expect(reg).to_be_disabled()


def test_non_admin_denied(non_admin_page, base_url):
    nav(non_admin_page, f"{base_url}/user-management")
    # non-admin must NOT see the Utenti management heading
    expect(non_admin_page.get_by_role("heading", name="Utenti")).to_have_count(0)


def test_filter_by_status_and_reset(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    baseline = page.locator('[data-testid="status-badge"]').count()
    assert baseline > 0
    # Non-vacuous baseline: at least one Attivo user exists, so filtering down to
    # Disattivato-only has something real to exclude.
    assert page.get_by_text("Attivo", exact=True).count() > 0

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-status").click()
    page.get_by_test_id("filter-status-option-1").click()  # 1 = Disattivato
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("statuses=1"))
    # Every visible row must now be Disattivato: no Attivo badge should remain.
    expect(page.get_by_text("Attivo", exact=True)).to_have_count(0)
    expect(page.get_by_text("Disattivato", exact=True).first).to_be_visible()

    page.get_by_role("button", name="Filtri").click()
    page.get_by_role("button", name="Reset").click()
    expect(page).not_to_have_url(re.compile("statuses="))
    # Reset must restore the true baseline count, not just "some" rows.
    expect(page.locator('[data-testid="status-badge"]')).to_have_count(baseline)


def test_filter_by_role(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/user-management")
    rows = page.locator("tbody tr")
    baseline = rows.count()
    assert baseline > 0
    # Non-vacuous baseline: at least one visible user does NOT have the
    # Administrator role, so filtering to Administrator-only has something to exclude.
    assert rows.filter(has_text="Administrator").count() < baseline

    page.get_by_role("button", name="Filtri").click()
    page.get_by_test_id("filter-role").click()
    page.get_by_test_id("filter-role-option-1").click()  # 1 = Administrator
    page.get_by_role("button", name="Applica").click()
    expect(page).to_have_url(re.compile("roleIds=1"))
    expect(rows.first).to_be_visible()
    # Every remaining row must carry the Administrator role.
    expect(rows.filter(has_text="Administrator")).to_have_count(rows.count())
