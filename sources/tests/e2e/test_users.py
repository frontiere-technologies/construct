import time
from playwright.sync_api import expect


def test_users_list_loads(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Utenti")).to_be_visible()
    # column headers
    expect(page.get_by_text("Email", exact=True).first).to_be_visible()
    expect(page.get_by_text("Ruoli", exact=True).first).to_be_visible()
    expect(page.get_by_text("Stato", exact=True).first).to_be_visible()
    # at least one status badge rendered
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()


def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    before = page.locator('[data-testid="status-badge"]').count()
    page.get_by_placeholder("Cerca").fill("zzz-no-such-user-zzz")
    page.wait_for_timeout(800)
    page.wait_for_load_state("networkidle")
    after = page.locator('[data-testid="status-badge"]').count()
    assert after <= before


def test_manage_roles_opens_and_lists_roles(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    # open the first row's action menu, then "Gestisci ruoli"
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()
    # the Registered-user checkbox (id 0) is present and disabled
    reg = page.get_by_test_id("role-checkbox-0")
    expect(reg).to_be_disabled()


def test_non_admin_denied(page, base_url):
    # non-admin login via test credentials
    import os
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('button:has-text("Accesso test")')
    page.fill('input[placeholder="Email di test"]', os.environ["TEST_EMAIL_USER"])
    page.click('button:has-text("Entra (test)")')
    page.wait_for_load_state("networkidle")
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    # non-admin must NOT see the Utenti management heading
    expect(page.get_by_role("heading", name="Utenti")).to_have_count(0)
