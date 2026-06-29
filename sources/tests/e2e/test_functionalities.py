import time
from playwright.sync_api import expect


def test_tree_loads_with_tabs(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/functionalities")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_role("button", name="Tutto")).to_be_visible()
    expect(page.get_by_role("button", name="Operazioni")).to_be_visible()
    # Seeded immutable category RBAC is visible in the tree
    expect(page.get_by_text("RBAC", exact=True).first).to_be_visible()


def test_create_edit_delete_functionality(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Func {int(time.time())}"
    # Create — navigate with ?root=root so the server knows which subtree
    page.goto(f"{base_url}/functionalities/create?root=root")
    page.wait_for_load_state("networkidle")
    # Fill IT name (first input with that placeholder)
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    # Fill IT description (textarea)
    page.get_by_placeholder("Descrizione *").fill("desc e2e")
    # idItemType defaults to 2 (Funzionalità) — Tipologia select is select[1]
    # select[0] = parent, select[1] = Tipologia (only visible when Funzionalità is selected)
    page.locator("select").nth(1).select_option("3")  # Funzionalità interna
    page.get_by_placeholder("Link *").fill("/e2e-func")
    page.get_by_role("button", name="Crea funzionalità").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(name, exact=True).first).to_be_visible()

    # Edit — find the edit button on the row matching our created item.
    # Scroll the name into view first, then find the closest nav-edit button.
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    # The trailing actions are rendered inside the same tree row; navigate to edit
    # by locating the row container div and clicking its nav-edit button.
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-edit"]')).last
    row.locator('[data-testid="nav-edit"]').click()
    page.wait_for_url("**/edit", timeout=10_000)
    page.wait_for_load_state("networkidle")
    renamed = name + " R"
    it_name = page.get_by_placeholder("Nome funzionalità *")
    it_name.fill(renamed)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(renamed, exact=True).first).to_be_visible()

    # Delete — find the row for the renamed item and click its delete button.
    page.get_by_text(renamed, exact=True).first.scroll_into_view_if_needed()
    delete_row = page.locator("div").filter(has_text=renamed).filter(has=page.locator('[data-testid="nav-delete"]')).last
    page.once("dialog", lambda d: d.accept())
    delete_row.locator('[data-testid="nav-delete"]').click()
    page.wait_for_timeout(800)
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(renamed, exact=True)).to_have_count(0)


def test_immutable_item_has_no_actions(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/functionalities")
    page.wait_for_load_state("networkidle")
    # RBAC is immutable — its OWN row must expose no edit/delete buttons.
    # Scope to the label's row container (parent of the name span) so that
    # neither child rows nor any unrelated mutable item elsewhere in the tree
    # can leak their action buttons into this assertion.
    rbac_label = page.get_by_text("RBAC", exact=True).first
    expect(rbac_label).to_be_visible()
    rbac_row = rbac_label.locator("xpath=..")
    expect(rbac_row.locator('[data-testid="nav-delete"]')).to_have_count(0)
    expect(rbac_row.locator('[data-testid="nav-edit"]')).to_have_count(0)
