import time
from playwright.sync_api import expect
from helpers import nav, drag_row_onto


def _select_tipologia(page, label: str):
    """Open the Tipologia custom-select dropdown and click an option by label."""
    page.locator('[data-testid="select-tipologia"]').click()
    page.get_by_role("button", name=label, exact=True).first.click()


def _create_functionality(page, base_url, name, link):
    """Create an internal-link-functionality tree item at the root level."""
    nav(page, f"{base_url}/functionalities/create?root=root")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e")
    _select_tipologia(page, "Link interno (/path)")
    page.get_by_placeholder("Link *").fill(link)
    page.get_by_role("button", name="Crea funzionalità").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _delete_functionality(page, base_url, name):
    nav(page, f"{base_url}/functionalities")
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-delete"]')).last
    page.once("dialog", lambda d: d.accept())
    row.locator('[data-testid="nav-delete"]').click()
    page.wait_for_timeout(600)


def test_tree_loads_with_tabs(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_role("button", name="Tutto")).to_be_visible()
    expect(page.get_by_role("button", name="Operazioni")).to_be_visible()
    # Seeded immutable category Admin is visible in the tree
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()


def test_create_button_aligned_with_filtri(logged_in_page, base_url):
    """F-01: 'Crea nuovo' must sit at toolbar height (next to Filtri), not at title height."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    title_box = page.get_by_role("heading", name="Funzionalità").bounding_box()
    filtri_box = page.get_by_test_id("open-filters").bounding_box()
    create_box = page.get_by_role("button", name="Crea nuovo").bounding_box()
    assert create_box["y"] != title_box["y"]
    assert abs(create_box["y"] - filtri_box["y"]) < 2


def test_filter_drawer_search(logged_in_page, base_url):
    """V-02: Cerca lives inside the Filtri drawer, gated behind Applica/Reset."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_placeholder("Cerca")).to_have_count(0)

    page.get_by_test_id("open-filters").click()
    page.get_by_placeholder("Cerca").fill("Admin")
    page.get_by_role("button", name="Applica").click()
    # Wait for drawer to close and filter to apply
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()
    expect(page.get_by_text("Home", exact=True)).to_have_count(0)

    page.get_by_test_id("open-filters").click()
    page.get_by_role("button", name="Reset").click()
    # Wait for drawer to close and filter to reset
    expect(page.get_by_text("Home", exact=True).first).to_be_visible()


def test_filters_badge_and_clear(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)

    page.get_by_test_id("open-filters").click()
    page.get_by_placeholder("Cerca").fill("Admin")
    page.get_by_role("button", name="Applica").click()
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()

    expect(page.locator('[data-testid="filters-badge"]')).to_have_text("1")
    expect(page.locator('[data-testid="clear-filters"]')).to_be_visible()

    page.get_by_test_id("clear-filters").click()
    expect(page.get_by_text("Home", exact=True).first).to_be_visible()
    expect(page.locator('[data-testid="filters-badge"]')).to_have_count(0)
    expect(page.locator('[data-testid="clear-filters"]')).to_have_count(0)


def test_create_edit_delete_functionality(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Func {int(time.time())}"
    # Create — navigate with ?root=root so the server knows which subtree
    nav(page, f"{base_url}/functionalities/create?root=root")
    # Fill IT name (first input with that placeholder)
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    # Fill IT description (textarea)
    page.get_by_placeholder("Descrizione *").fill("desc e2e")
    _select_tipologia(page, "Link interno (/path)")
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
    nav(page, f"{base_url}/functionalities")
    # Admin is immutable — its OWN row must expose no edit/delete buttons.
    # Scope to the label's row container (parent of the name span) so that
    # neither child rows nor any unrelated mutable item elsewhere in the tree
    # can leak their action buttons into this assertion.
    admin_label = page.get_by_text("Admin", exact=True).first
    expect(admin_label).to_be_visible()
    admin_row = admin_label.locator("xpath=..")
    expect(admin_row.locator('[data-testid="nav-delete"]')).to_have_count(0)
    expect(admin_row.locator('[data-testid="nav-edit"]')).to_have_count(0)


def test_immutable_item_has_no_add_button(logged_in_page, base_url):
    """F-01 (revised): immutable items (Home, Admin) have no +/edit/delete buttons."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    for label in ("Home", "Admin"):
        row = page.locator("div").filter(has_text=label).filter(
            has=page.locator('[data-testid="drag-handle"]')
        ).last
        expect(row.locator('[data-testid="nav-add"]')).to_have_count(0)
        expect(row.locator('[data-testid="nav-edit"]')).to_have_count(0)
        expect(row.locator('[data-testid="nav-delete"]')).to_have_count(0)


def test_mutable_item_has_all_action_buttons(logged_in_page, base_url):
    """F-01: mutable items (user-created) expose +, edit, and delete buttons."""
    import time
    page = logged_in_page
    name = f"E2E BtnTest {int(time.time())}"
    _create_functionality(page, base_url, name, f"/e2e-btn-{int(time.time())}")
    nav(page, f"{base_url}/functionalities")
    row = page.locator("div").filter(has_text=name).filter(
        has=page.locator('[data-testid="drag-handle"]')
    ).last
    expect(row.locator('[data-testid="nav-add"]')).to_have_count(1)
    expect(row.locator('[data-testid="nav-edit"]')).to_have_count(1)
    expect(row.locator('[data-testid="nav-delete"]')).to_have_count(1)
    _delete_functionality(page, base_url, name)


def test_drag_moves_item_after_last(logged_in_page, base_url):
    """F-02: an item can be dropped *after* the last element (regression test)."""
    page = logged_in_page
    ts = int(time.time())
    a, b = f"E2E Drag A {ts}", f"E2E Drag B {ts}"
    _create_functionality(page, base_url, a, f"/e2e-drag-a-{ts}")
    _create_functionality(page, base_url, b, f"/e2e-drag-b-{ts}")
    try:
        # Both appended at the end (a before b, with b now the last row). Drag a after b.
        nav(page, f"{base_url}/functionalities")
        drag_row_onto(page, a, b, rel_y=0.85)
        # Poll until the server action + refresh land the new order.
        page.wait_for_function(
            """([a, b]) => {
                const labels = [...document.querySelectorAll('.rounded-lg.border span.flex-1')].map(e => e.textContent.trim());
                return labels.includes(a) && labels.includes(b) && labels.indexOf(a) > labels.indexOf(b);
            }""",
            arg=[a, b],
            timeout=8_000,
        )
    finally:
        _delete_functionality(page, base_url, a)
        _delete_functionality(page, base_url, b)
