import time

from playwright.sync_api import expect


def test_roles_list_loads(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("Ruoli & permessi").first.is_visible()
    # Administrator (id 1) is seeded and must appear
    assert page.get_by_text("Administrator", exact=True).first.is_visible()


def test_create_rename_delete_role(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")

    name = f"E2E Role {int(time.time())}"
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    # Redirects to the detail page of the new SERVICE role
    page.wait_for_url("**/rolesPermissions/**", timeout=10_000)
    assert name in page.inner_text("h1")

    # Rename via the pencil (SERVICE roles are renamable)
    renamed = name + " R"
    page.get_by_test_id("rename-role-btn").click()
    page.get_by_placeholder("Nome ruolo").fill(renamed)
    page.get_by_role("button", name="Salva").click()
    # Wait for the heading to reflect the rename (retrying assertion)
    expect(page.locator("h1")).to_contain_text(renamed)

    # Back to list, delete it — use search input to avoid URL encoding issues
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder("Cerca").fill(renamed)
    # Wait for the filtered row to appear (debounce ~350ms, default timeout retries)
    # Use the row that contains the renamed text specifically
    row = page.locator("tr").filter(has_text=renamed)
    expect(row).to_be_visible()
    row.locator('[data-testid="row-menu"]').click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    # Navigate to list and confirm the role is gone
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder("Cerca").fill(renamed)
    expect(page.get_by_text(renamed, exact=True)).to_have_count(0)


def test_toggle_permission_persists(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Perm {int(time.time())}"
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    page.wait_for_url("**/rolesPermissions/**", timeout=10_000)
    detail_url = page.url

    page.get_by_role("button", name="Modifica").click()
    page.locator('[data-testid="perm-toggle"]').first.click()
    page.get_by_role("button", name="Salva").click()

    # Wait for save to complete: edit mode exits → "Modifica" button reappears
    page.get_by_role("button", name="Modifica").wait_for(state="visible", timeout=10_000)

    # Reload and assert at least one permission toggle is ON
    page.goto(detail_url)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector('[data-testid="perm-toggle"][aria-checked="true"]', timeout=10_000)
    assert page.locator('[data-testid="perm-toggle"][aria-checked="true"]').count() >= 1


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions/1")  # Administrator = SYSTEM
    page.wait_for_load_state("networkidle")
    edit = page.get_by_role("button", name="Modifica")
    assert edit.is_disabled()
