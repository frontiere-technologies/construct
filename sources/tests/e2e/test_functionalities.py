import time
from playwright.sync_api import expect
from helpers import nav, drag_row_onto, confirm_modal


def _select_tipologia(page, label: str):
    """Open the Tipologia custom-select dropdown and click an option by label.

    Scoped to the open dropdown panel, not the whole page: when `label` matches
    the tipologia already shown on the closed trigger, an unscoped
    `get_by_role("button", name=label).first` would resolve to the trigger button
    itself (it renders before the dropdown panel), just toggling it closed again
    instead of firing onChange.
    """
    page.locator('[data-testid="select-tipologia"]').click()
    page.get_by_role("listbox", name="Tipologia").get_by_role(
        "option", name=label, exact=True
    ).click()


def _create_functionality(page, base_url, name, link):
    """Create an internal-link-functionality tree item at the root level."""
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e")
    _select_tipologia(page, "Link interno (/path)")
    page.get_by_placeholder("Link *").fill(link)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _delete_functionality(page, base_url, name):
    nav(page, f"{base_url}/functionalities")
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-delete"]')).last
    row.locator('[data-testid="nav-delete"]').click()
    confirm_modal(page, "Elimina")


def test_tree_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_role("button", name="Operazioni")).to_have_count(0)
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
    # Create — navigate to create page
    nav(page, f"{base_url}/functionalities/create")
    # Fill IT name (first input with that placeholder)
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    # Fill IT description (textarea)
    page.get_by_placeholder("Descrizione *").fill("desc e2e")
    _select_tipologia(page, "Link interno (/path)")
    page.get_by_placeholder("Link *").fill("/e2e-func")
    page.get_by_role("button", name="Salva").click()
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
    delete_row.locator('[data-testid="nav-delete"]').click()
    confirm_modal(page, "Elimina")
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


def test_immutable_category_can_take_children_but_not_be_edited(logged_in_page, base_url):
    """Home and Admin are immutable *categories*: they offer + (new item inside) but no edit/delete."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    for label in ("Home", "Admin"):
        row = page.locator("div").filter(has_text=label).filter(
            has=page.locator('[data-testid="drag-handle"]')
        ).last
        expect(row.locator('[data-testid="nav-add"]')).to_have_count(1)
        expect(row.locator('[data-testid="nav-edit"]')).to_have_count(0)
        expect(row.locator('[data-testid="nav-delete"]')).to_have_count(0)


def test_functionality_row_has_no_add_button(logged_in_page, base_url):
    """Only categories can hold children, so a functionality shows edit/delete but never +."""
    page = logged_in_page
    name = f"E2E BtnTest {int(time.time())}"
    _create_functionality(page, base_url, name, f"/e2e-btn-{int(time.time())}")
    try:
        nav(page, f"{base_url}/functionalities")
        row = page.locator("div").filter(has_text=name).filter(
            has=page.locator('[data-testid="drag-handle"]')
        ).last
        expect(row.locator('[data-testid="nav-add"]')).to_have_count(0)
        expect(row.locator('[data-testid="nav-edit"]')).to_have_count(1)
        expect(row.locator('[data-testid="nav-delete"]')).to_have_count(1)
    finally:
        _delete_functionality(page, base_url, name)


def test_mutable_category_has_all_action_buttons(logged_in_page, base_url):
    """A user-created category exposes +, edit and delete."""
    page = logged_in_page
    name = f"E2E CatBtn {int(time.time())}"
    _create_category(page, base_url, name)
    try:
        nav(page, f"{base_url}/functionalities")
        row = page.locator("div").filter(has_text=name).filter(
            has=page.locator('[data-testid="drag-handle"]')
        ).last
        expect(row.locator('[data-testid="nav-add"]')).to_have_count(1)
        expect(row.locator('[data-testid="nav-edit"]')).to_have_count(1)
        expect(row.locator('[data-testid="nav-delete"]')).to_have_count(1)
    finally:
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


def test_functionality_create_annulla_navigates_back(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_role("button", name="Annulla").click()
    page.wait_for_url("**/functionalities", timeout=10_000)


def _create_category(page, base_url, name):
    """Create a root-level Category item (no link field)."""
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e category")
    _select_tipologia(page, "Category")
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def test_tipologia_starts_unselected(logged_in_page, base_url):
    """Tipologia must not pre-display "Category" (a real option) while nothing is selected:
    the placeholder shows instead, the Link field stays hidden, and Salva stays disabled."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    tipologia = page.locator('[data-testid="select-tipologia"]')
    expect(tipologia).to_have_text("Tipologia *")
    expect(page.get_by_placeholder("Link *")).to_have_count(0)

    page.get_by_placeholder("Nome funzionalità *").fill("E2E Tipologia")
    page.get_by_placeholder("Descrizione *").fill("e2e")
    expect(page.get_by_role("button", name="Salva")).to_be_disabled()

    _select_tipologia(page, "Link interno (/path)")
    expect(tipologia).to_have_text("Link interno (/path)")
    expect(page.get_by_placeholder("Link *")).to_be_visible()

    # Category is a functionality-free kind: choosing it hides the Link field again
    _select_tipologia(page, "Category")
    expect(tipologia).to_have_text("Category")
    expect(page.get_by_placeholder("Link *")).to_have_count(0)


def test_genitore_defaults_to_root(logged_in_page, base_url):
    """Genitore shows Root — not an empty placeholder — when creating at the top level."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    expect(page.locator('[data-testid="select-genitore"]')).to_have_text("Root")


def test_genitore_dropdown_lists_root_and_categories(logged_in_page, base_url):
    """Genitore lists Root plus every mutable category, and Root can be picked back."""
    page = logged_in_page
    name = f"E2E Cat Root {int(time.time())}"
    _create_category(page, base_url, name)
    try:
        nav(page, f"{base_url}/functionalities/create")
        genitore = page.locator('[data-testid="select-genitore"]')
        expect(genitore).to_be_enabled()
        genitore.click()
        menu = page.get_by_role("listbox", name="Genitore")
        expect(menu.get_by_role("option", name="Root", exact=True)).to_be_visible()
        expect(menu.get_by_role("option", name=name, exact=True)).to_be_visible()

        menu.get_by_role("option", name=name, exact=True).click()
        expect(genitore).to_have_text(name)

        genitore.click()
        page.locator('[data-testid="select-genitore-option-0"]').click()
        expect(genitore).to_have_text("Root")
    finally:
        _delete_functionality(page, base_url, name)


def test_textareas_are_at_least_two_input_rows_tall(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    single_line = page.get_by_placeholder("Nome funzionalità *").bounding_box()["height"]
    for label, locator in (
        ("Descrizione *", page.get_by_placeholder("Descrizione *")),
        ("Descrizione (traduzioni)", page.get_by_placeholder("Descrizione", exact=True).first),
    ):
        h = locator.bounding_box()["height"]
        assert h >= 2 * single_line - 1, \
            f"{label} is {h}px, expected >= 2x a single-line input ({single_line}px)"


def test_tag_input_placeholder_is_the_hint(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    expect(page.get_by_placeholder("Tags (IT)")).to_have_count(0)
    # One in "Informazioni generali" plus one per locale in the translations accordion
    assert page.get_by_placeholder("Inserisci un tag e premi invio").count() >= 2


def test_external_link_new_tab_flag(logged_in_page, base_url):
    """Only "Link esterno (http[s])" carries the new-tab flag; it defaults to on and persists."""
    page = logged_in_page
    ts = int(time.time())
    name = f"E2E Ext {ts}"
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e")

    flag = page.locator('[data-testid="check-open-in-new-tab"]')
    _select_tipologia(page, "Link interno (/path)")
    expect(flag).to_have_count(0)
    _select_tipologia(page, "Category")
    expect(flag).to_have_count(0)

    _select_tipologia(page, "Link esterno (http[s])")
    expect(flag).to_be_checked()  # default: open in a new tab
    page.get_by_placeholder("Link *").fill("https://example.com")
    flag.uncheck()
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")
    try:
        # Reopen: the cleared flag survived the round-trip
        page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        edit_url = page.url
        expect(page.locator('[data-testid="check-open-in-new-tab"]')).not_to_be_checked()

        # ...and setting it back to a new tab persists too
        page.locator('[data-testid="check-open-in-new-tab"]').check()
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)
        nav(page, edit_url)
        expect(page.locator('[data-testid="check-open-in-new-tab"]')).to_be_checked()
    finally:
        _delete_functionality(page, base_url, name)


def _pick_genitore(page, label: str):
    """Open the Genitore dropdown and click an option by label (scoped to the open panel)."""
    page.locator('[data-testid="select-genitore"]').click()
    page.get_by_role("listbox", name="Genitore").get_by_role(
        "option", name=label, exact=True
    ).click()


def _row_padding_left(page, name: str):
    """padding-left of the tree row for `name` — 12px at the root, +24px per nesting level."""
    return page.evaluate(
        """(n) => {
            const span = [...document.querySelectorAll('span.flex-1')].find(e => e.textContent.trim() === n);
            return span ? span.parentElement.style.paddingLeft : null;
        }""",
        name,
    )


def test_edit_can_change_genitore(logged_in_page, base_url):
    """Editable items can be reparented from the form, not only by dragging them in the tree."""
    page = logged_in_page
    ts = int(time.time())
    cat, func = f"E2E Parent {ts}", f"E2E Child {ts}"
    _create_category(page, base_url, cat)
    _create_functionality(page, base_url, func, f"/e2e-child-{ts}")
    try:
        nav(page, f"{base_url}/functionalities")
        assert _row_padding_left(page, func) == "12px"  # still at the root
        page.get_by_text(func, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=func).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        edit_url = page.url

        genitore = page.locator('[data-testid="select-genitore"]')
        expect(genitore).to_be_enabled()
        expect(genitore).to_have_text("Root")
        _pick_genitore(page, cat)
        expect(genitore).to_have_text(cat)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)
        page.wait_for_load_state("networkidle")

        # Persisted: the item is now a child row of the category, and the form reflects it
        assert _row_padding_left(page, func) == "36px"
        nav(page, edit_url)
        expect(page.locator('[data-testid="select-genitore"]')).to_have_text(cat)

        # ...and it can be moved back to the root the same way
        _pick_genitore(page, "Root")
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)
        page.wait_for_load_state("networkidle")
        assert _row_padding_left(page, func) == "12px"
    finally:
        _delete_functionality(page, base_url, func)
        _delete_functionality(page, base_url, cat)


def test_edit_genitore_excludes_own_subtree(logged_in_page, base_url):
    """A category must not be able to become a child of itself or of its own descendants."""
    page = logged_in_page
    ts = int(time.time())
    parent, child = f"E2E Outer {ts}", f"E2E Inner {ts}"
    _create_category(page, base_url, parent)
    _create_category(page, base_url, child)
    try:
        # Nest child under parent via the form
        nav(page, f"{base_url}/functionalities")
        page.get_by_text(child, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=child).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        _pick_genitore(page, parent)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)
        page.wait_for_load_state("networkidle")

        # Editing the parent: neither itself nor its descendant may be offered as Genitore
        page.get_by_text(parent, exact=True).first.scroll_into_view_if_needed()
        prow = page.locator("div").filter(has_text=parent).filter(has=page.locator('[data-testid="nav-edit"]')).last
        prow.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        page.locator('[data-testid="select-genitore"]').click()
        menu = page.get_by_role("listbox", name="Genitore")
        expect(menu.get_by_role("option", name="Root", exact=True)).to_be_visible()
        expect(menu.get_by_role("option", name=parent, exact=True)).to_have_count(0)
        expect(menu.get_by_role("option", name=child, exact=True)).to_have_count(0)
    finally:
        _delete_functionality(page, base_url, child)
        _delete_functionality(page, base_url, parent)


def test_genitore_dropdown_lists_every_category(logged_in_page, base_url):
    """Genitore offers Root, the immutable seeded sections (Home, Admin) and every user
    category — and still no clickable 'Genitore' placeholder row."""
    page = logged_in_page
    name = f"E2E Category {int(time.time())}"
    _create_category(page, base_url, name)
    try:
        nav(page, f"{base_url}/functionalities/create")
        genitore = page.locator('[data-testid="select-genitore"]')
        expect(genitore).to_be_enabled()
        genitore.click()
        menu = page.get_by_role("listbox", name="Genitore")
        expect(menu.get_by_role("option", name="Genitore", exact=True)).to_have_count(0)
        for label in ("Root", "Home", "Admin", name):
            expect(menu.get_by_role("option", name=label, exact=True)).to_be_visible()
        # Home (pinned top), Root, Admin (pinned bottom), then the user categories
        labels = [t.strip() for t in menu.get_by_role("option").all_inner_texts()]
        assert labels[:3] == ["Home", "Root", "Admin"], f"Unexpected Genitore order: {labels}"
        assert name in labels[3:], f"{name} should follow the pinned sections: {labels}"
        # Operations is not a placement target
        expect(menu.get_by_role("option", name="Operations", exact=True)).to_have_count(0)
        expect(menu.get_by_role("option", name="Operazioni", exact=True)).to_have_count(0)
    finally:
        _delete_functionality(page, base_url, name)


def test_add_button_on_immutable_section_preselects_it_as_parent(logged_in_page, base_url):
    """The + on Admin opens the create form already parented to Admin."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    row = page.locator("div").filter(has_text="Admin").filter(
        has=page.locator('[data-testid="drag-handle"]')
    ).last
    row.locator('[data-testid="nav-add"]').click()
    page.wait_for_url("**/functionalities/create?parent=*", timeout=10_000)
    expect(page.locator('[data-testid="select-genitore"]')).to_have_text("Admin")

def _create_category(page, base_url, name):
    """Create a category (a menu container, no functionality type) at the root level."""
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e")
    _select_tipologia(page, "Category")
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _open_edit(page, base_url, name):
    """Open a tree row's edit page through its nav-edit button (same idiom as
    test_create_edit_delete_functionality: the trailing actions live inside the row)."""
    nav(page, f"{base_url}/functionalities")
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-edit"]')).last
    row.locator('[data-testid="nav-edit"]').click()
    page.wait_for_url("**/edit", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _tipologia_wrapper(page):
    """The div that carries the disabled-select tooltip.

    CustomSelect puts `title` on its wrapping div, not on the <button>: a disabled
    button receives no mouse events, so a title on it would never show. Anyone
    checking the attribute on the button concludes wrongly that it is missing.
    """
    return page.locator('div[title]').filter(has=page.locator('[data-testid="select-tipologia"]'))


def test_tipologia_in_edit_offers_only_the_functionality_subtypes(logged_in_page, base_url):
    """On an existing functionality the type stays changeable BETWEEN SUBTYPES, and
    "Category" is not on offer.

    Il divieto resta, il motivo è cambiato (DEC-22): non esiste più una «voce pubblica»
    da creare per sbaglio, perché menu_entry non porta più id_permission. Quel che
    sopravvive è l'altro verso — convertire una funzionalità in categoria butterebbe
    via le sue concessioni in silenzio, perché una cartella non è concedibile.
    """
    page = logged_in_page
    name = f"E2E Subtype {int(time.time())}"
    _create_functionality(page, base_url, name, "/e2e-subtype")

    _open_edit(page, base_url, name)
    tipologia = page.locator('[data-testid="select-tipologia"]')
    expect(tipologia).to_be_enabled()
    expect(_tipologia_wrapper(page)).to_have_count(0)  # no "locked" tooltip on a functionality

    tipologia.click()
    options = page.get_by_role("listbox", name="Tipologia").get_by_role("option")
    expect(options).to_have_count(3)
    expect(page.get_by_role("listbox", name="Tipologia").get_by_role("option", name="Category", exact=True)).to_have_count(0)
    page.keyboard.press("Escape")

    # And the change actually persists: internal link -> external link.
    _select_tipologia(page, "Link esterno (http[s])")
    page.get_by_placeholder("Link *").fill("https://example.invalid/e2e")
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")

    _open_edit(page, base_url, name)
    expect(page.locator('[data-testid="select-tipologia"]')).to_have_text("Link esterno (http[s])")

    _delete_functionality(page, base_url, name)


def test_tipologia_in_edit_is_locked_on_a_category(logged_in_page, base_url):
    """On a category the one boundary the server defends is the whole choice, so the
    control is genuinely locked — and says why, instead of being a live dropdown that
    does nothing."""
    page = logged_in_page
    name = f"E2E Cat {int(time.time())}"
    _create_category(page, base_url, name)

    _open_edit(page, base_url, name)
    expect(page.locator('[data-testid="select-tipologia"]')).to_be_disabled()
    expect(_tipologia_wrapper(page)).to_have_attribute(
        "title", "La tipologia non può essere modificata dopo la creazione"
    )

    _delete_functionality(page, base_url, name)
