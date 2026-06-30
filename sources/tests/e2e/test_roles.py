import time

from playwright.sync_api import expect
from helpers import nav


def _create_role(page, base_url, name):
    """Create a SERVICE role; lands on its detail page. Returns the detail URL."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    # Higher timeout: first hit to the detail route triggers Next.js dev-mode compilation (~3-5s)
    page.wait_for_url("**/roles-permissions/**", timeout=15_000)
    return page.url


def _delete_role(page, base_url, name):
    """Delete a role via the list search + row menu, then assert it's gone."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_placeholder("Cerca").fill(name)
    row = page.locator("tr").filter(has_text=name)
    expect(row).to_be_visible()
    row.locator('[data-testid^="row-menu"]').click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_placeholder("Cerca").fill(name)
    expect(page.get_by_text(name, exact=True)).to_have_count(0)


def test_roles_list_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    assert page.get_by_text("Ruoli & permessi").first.is_visible()
    # Administrator (id 1) is seeded and must appear
    assert page.get_by_text("Administrator", exact=True).first.is_visible()


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
    assert page.locator('[data-testid="perm-toggle"][aria-checked="true"]').count() >= 1

    # Cleanup: delete the role this test created (avoid leaking E2E roles into the DB)
    _delete_role(page, base_url, name)


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions/1")  # Administrator = SYSTEM
    edit = page.get_by_role("button", name="Modifica")
    assert edit.is_disabled()
