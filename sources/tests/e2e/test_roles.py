import warnings
import re
import time
from datetime import datetime, timedelta, timezone

from playwright.sync_api import expect
from helpers import nav, open_column_filter as _open_column_filter, grid_rows as _rows, confirm_modal
from test_functionalities import _create_category, _create_functionality, _delete_functionality, _pick_genitore


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
    """Delete a role via the column filter + row menu + confirm modal, then assert it's gone.

    Deletion is confirmed via a custom ConfirmModal (not a native browser dialog).
    This used to re-query "Elimina" by role/name twice, which worked here because
    the row menu closes as the modal opens so the two never coexist. It now goes
    through helpers.confirm_modal, which scopes the query to the dialog: the same
    idiom is needed on the functionalities tree, where the row's delete trigger
    carries the same label AND stays in the DOM behind the modal.
    """
    _search(page, base_url, name)
    row = _rows(page).filter(has_text=name)
    expect(row).to_be_visible()
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.click()
    page.get_by_role("button", name="Elimina").click()  # row-menu item -> opens ConfirmModal
    confirm_modal(page, "Elimina")
    _search(page, base_url, name)
    expect(_rows(page).filter(has_text=name)).to_have_count(0)


def _report_cleanup_failure(message: str) -> None:
    """Surface a cleanup failure through a channel a plain `uv run pytest` shows.

    A bare `print` is captured and discarded by pytest's default output capture
    for any test whose outcome is "passed" — and that is precisely the case this
    exists to cover: the test body's own assertions all succeeded, only its
    `finally`-time deletion silently failed. `warnings.warn` is different: pytest
    collects warnings into the terminal's summary regardless of a test's outcome,
    so this is the channel that actually survives the one case a print does not.
    The print stays too, for anyone re-running with `-s`.
    """
    print(f"[cleanup] {message}")
    warnings.warn(message)


def _safe_delete_role(page, base_url, name) -> None:
    """Cleanup safety net for a role: delete `name` if it is present, and do nothing
    (not raise) if it never was.

    Used in a `finally` that starts covering resources from before the first one is
    created — a setup step earlier in the same test can throw and leave a later
    resource never created at all, and this must not itself fail in that case, or it
    would replace the real failure with a misleading one raised while cleaning up.

    The presence check is a bounded, RETRYING `expect(...).to_be_visible()`, not a
    bare `.count()`: `_search` applies the grid filter via a network round trip, and
    `wait_for_load_state("networkidle")` inside it only confirms that response
    landed — not that AG Grid has finished painting the resulting row. A bare
    `.count()` right after can read 0 during that gap and skip a role that is very
    much still there, which is exactly the failure this safety net had at first:
    three real roles left behind, each wrongly concluded "never created".

    EVERYTHING here — the leading `_search`, and the real `_delete_role` call, not
    only the presence check — runs inside try/except, and nothing this function
    does ever raises. Three `_safe_delete_*` calls sit back to back in the same
    `finally` in each of the three new tests: if one of them let an exception
    through (a flaky row-menu click, a confirm modal that doesn't close, the
    trailing count-is-zero assertion inside `_delete_role`), the sibling calls
    after it in that `finally` would never run, turning one lost row into several.
    A failure here is reported, not raised, precisely so it cannot cancel a sibling
    cleanup, and precisely so it cannot replace — by raising fresh from a `finally`
    — the real exception of a test that failed for its own reason (or flip a
    passing test to failing over a cleanup-only problem). See
    _report_cleanup_failure above for why that report goes through
    `warnings.warn` and not only a `print`: the case this exists to catch is a
    test whose own assertions all passed, and pytest's default capture discards
    printed output for exactly that outcome.
    """
    try:
        _search(page, base_url, name)
        expect(_rows(page).filter(has_text=name)).to_be_visible(timeout=5_000)
    except AssertionError:
        return  # never created, or gone already — nothing to clean up
    except Exception as err:
        _report_cleanup_failure(f"could not check whether role {name!r} still exists: {err}")
        return

    try:
        _delete_role(page, base_url, name)
    except Exception as err:
        _report_cleanup_failure(f"failed to delete role {name!r}, it may still be in the database: {err}")


def _safe_delete_functionality(page, base_url, name) -> None:
    """Cleanup safety net for a functionality/category: delete `name` if it is
    present, and do nothing if it never was created or if the test's own exercised
    behaviour already deleted it (test_deleted_functionality_disappears_from_roles
    does exactly that as the action under test, before this safety net ever runs).

    Same reasoning as _safe_delete_role above, including the part that matters most
    here: the leading `nav` and the real `_delete_functionality` call are inside the
    same try/except as the presence check, and this function never raises — a
    failure is reported (via _report_cleanup_failure, not a bare print — see there)
    and swallowed so it cannot cancel the `_safe_delete_*` calls that follow it in
    the same `finally`, and cannot mask a real assertion failure from the test body
    by raising fresh out of `finally`.
    """
    try:
        nav(page, f"{base_url}/functionalities")
        expect(page.get_by_text(name, exact=True).first).to_be_visible(timeout=5_000)
    except AssertionError:
        return  # never created, or gone already — nothing to clean up
    except Exception as err:
        _report_cleanup_failure(f"could not check whether functionality {name!r} still exists: {err}")
        return

    try:
        _delete_functionality(page, base_url, name)
    except Exception as err:
        _report_cleanup_failure(f"failed to delete functionality {name!r}, it may still be in the database: {err}")


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

    # Rename via the pencil (SERVICE roles are renamable). The rename modal's own
    # "Salva" button is disambiguated via testid from the page's own Salva/Annulla
    # footer (always visible now that permissions are editable without a "Modifica" gate).
    renamed = name + " R"
    page.get_by_test_id("rename-role-btn").click()
    page.get_by_placeholder("Nome ruolo").fill(renamed)
    page.get_by_test_id("rename-role-save").click()
    # Wait for the heading to reflect the rename (retrying assertion)
    expect(page.locator("h1")).to_contain_text(renamed)

    _delete_role(page, base_url, renamed)


def test_toggle_permission_persists(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Perm {int(time.time())}"
    detail_url = _create_role(page, base_url, name)

    # Permissions are directly editable on the page (no "Modifica" gate) —
    # toggle a switch and save via the page's own Annulla/Salva footer.
    #
    # `:not([disabled])`, not a bare `.first`: the tree's first row is the root
    # category `Home`, and since Task 4 an empty folder (no functionality anywhere
    # in its subtree) renders a permanently disabled toggle (DEC-19's "empty
    # container hint") rather than an inert one. On this database Home has no
    # children at all, so a bare `.first` resolves to a control this test could
    # never click, regardless of the role being editable.
    page.locator('[data-testid="perm-toggle"]:not([disabled])').first.click()
    save_btn = page.get_by_role("button", name="Salva")
    # Make the transient busy state observable even when the server action is
    # faster than Playwright's assertion polling interval.
    page.evaluate(
        """() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 750));
                return originalFetch(...args);
            };
        }"""
    )
    save_btn.click()

    # Wait for the save request to settle before reloading: the button disables
    # while the server action is in flight and re-enables once it resolves, so
    # this avoids racing the in-flight updateRolePermissions call with the reload
    # below (a flat wait_for_load_state("networkidle") proved unreliable here).
    expect(save_btn).to_be_disabled()
    expect(save_btn).to_be_enabled()

    # Reload and assert at least one permission toggle is ON
    nav(page, detail_url)
    page.wait_for_selector('[data-testid="perm-toggle"][aria-checked="true"]', timeout=10_000)
    expect(page.locator('[data-testid="perm-toggle"][aria-checked="true"]').first).to_be_visible()

    # Cleanup: delete the role this test created (avoid leaking E2E roles into the DB)
    _delete_role(page, base_url, name)


def test_cancel_leaves_detail_page(logged_in_page, base_url):
    """"Annulla" on the role detail page must navigate back to the roles list,
    not just reset unsaved toggle state in place."""
    page = logged_in_page
    name = f"E2E Cancel {int(time.time())}"
    _create_role(page, base_url, name)

    # See test_toggle_permission_persists above: the tree's literal first row
    # (Home) is a permanently disabled empty folder, not a togglable control.
    page.locator('[data-testid="perm-toggle"]:not([disabled])').first.click()
    page.get_by_role("button", name="Annulla").click()
    # The grid may immediately persist its default sort in the query string.
    expect(page).to_have_url(re.compile(rf"^{re.escape(base_url)}/roles-permissions(?:\?.*)?$"))

    _delete_role(page, base_url, name)


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions/1")  # Administrator = SYSTEM
    # System roles keep the Annulla/Salva footer, but Salva is disabled (nothing
    # can be persisted) and permission toggles render disabled (read-only).
    expect(page.get_by_role("button", name="Salva")).to_be_disabled()
    expect(page.get_by_role("button", name="Annulla")).to_be_enabled()
    expect(page.locator('[data-testid="perm-toggle"]').first).to_be_disabled()

    # Annulla still exits the page even for a non-editable system role.
    page.get_by_role("button", name="Annulla").click()
    expect(page).to_have_url(re.compile(rf"^{re.escape(base_url)}/roles-permissions(?:\?.*)?$"))


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
    # PostgreSQL stores the creation timestamp in UTC. Derive the filter dates
    # from UTC too, otherwise a run just after local midnight can exclude the
    # role that was created a few seconds earlier on the previous UTC date.
    today = datetime.now(timezone.utc).date()
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


def test_actions_column_header_is_empty_and_has_no_divider(logged_in_page, base_url):
    """The icon-only actions column has no redundant text label or divider."""
    page = logged_in_page
    nav(page, f"{base_url}/roles-permissions")
    actions_header = page.locator('.ag-header-cell[col-id="actions"]')
    expect(actions_header).to_have_text("")

    assert actions_header.evaluate("el => getComputedStyle(el, '::after').display") == "none", \
        "The actions column must not draw a divider against the first text column"

    other_divider = page.locator('.ag-header-cell[col-id="description"]').evaluate(
        "el => getComputedStyle(el, '::after').borderRightColor"
    )
    assert other_divider != "rgba(0, 0, 0, 0)", \
        "Non-actions columns lost their header divider"


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


def _perm_row_toggle(page, name: str):
    """L'interruttore sulla riga dell'albero il cui nome è esattamente `name`.

    Scoped alla riga: il nome compare anche altrove nella pagina (la barra laterale
    porta le stesse etichette), e un `[data-testid="perm-toggle"]` non scoped
    risolverebbe il primo interruttore dell'albero invece di quello cercato.
    """
    return page.locator("div").filter(
        has=page.get_by_text(name, exact=True)
    ).filter(has=page.locator('[data-testid="perm-toggle"]')).last.locator('[data-testid="perm-toggle"]')


def test_roles_tree_follows_the_menu_tree(logged_in_page, base_url):
    """BUG-1: l'albero dei Ruoli È l'albero delle Funzionalità.

    Prima erano due alberi con due id_parent indipendenti, e solo quello del menu
    veniva aggiornato: una voce spostata restava dov'era in Ruoli, e un contenitore
    nuovo non compariva affatto. Nessun test copriva la divergenza.
    """
    page = logged_in_page
    ts = int(time.time())
    cat, func = f"E2E TreeCat {ts}", f"E2E TreeFunc {ts}"
    role_name = f"E2E TreeRole {ts}"

    # The try starts here, before the first creation: a failure partway through
    # setup (e.g. _create_role timing out after _create_category and
    # _create_functionality already succeeded) must not leak those two rows with
    # no cleanup attempt at all. The finally below covers all three unconditionally
    # via safety-net helpers that tolerate a resource never having been created.
    try:
        _create_category(page, base_url, cat)
        _create_functionality(page, base_url, func, f"/e2e-tree-{ts}")
        detail_url = _create_role(page, base_url, role_name)

        # La categoria appena creata compare in Ruoli: prima non ci arrivava mai,
        # perché un contenitore di menu non generava una riga in `permission`.
        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True).first).to_be_visible()
        expect(page.get_by_text(func, exact=True).first).to_be_visible()

        # Sposta la funzionalità dentro la categoria, dal form.
        nav(page, f"{base_url}/functionalities")
        page.get_by_text(func, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=func).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        _pick_genitore(page, cat)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)

        # E in Ruoli la voce è annidata: un livello più a destra della sua categoria.
        nav(page, detail_url)
        cat_pad = _tree_padding_left(page, cat)
        func_pad = _tree_padding_left(page, func)
        assert func_pad == cat_pad + 24, (
            f"{func} dovrebbe essere annidata sotto {cat}: "
            f"padding {func_pad}px contro {cat_pad}px"
        )
    finally:
        _safe_delete_role(page, base_url, role_name)
        _safe_delete_functionality(page, base_url, func)
        _safe_delete_functionality(page, base_url, cat)


def _tree_padding_left(page, name: str) -> int:
    """padding-left in px della riga dell'albero per `name` — 12 alla radice, +24 per livello."""
    value = page.evaluate(
        """(n) => {
            const span = [...document.querySelectorAll('span.flex-1')].find(e => e.textContent.trim() === n);
            return span ? span.parentElement.style.paddingLeft : null;
        }""",
        name,
    )
    assert value is not None, f"riga non trovata nell'albero: {name}"
    return int(value.replace("px", ""))


def _save_and_wait(page, detail_url: str) -> None:
    """Click Salva and wait for the server action's own response before returning.

    updateRolePermissions genuinely commits before its POST resolves (verified by
    querying `role_functionality` directly while investigating this test), but a bare
    `nav(page, detail_url)` fired right after the click races the fresh page's read
    against that still in-flight request: navigation can dispatch its GET before the
    POST's response lands, and that GET can be served from a state that predates the
    commit. Waiting for the POST's response first, instead of only the client-side
    busy indicator, sidesteps that ordering question entirely. Same class of hazard
    that test_toggle_permission_persists documents further up in this file.
    """
    target = detail_url.split("?")[0]
    with page.expect_response(lambda r: r.request.method == "POST" and r.url.split("?")[0] == target):
        page.get_by_role("button", name="Salva").click()


def test_folder_toggle_grants_and_revokes_the_subtree(logged_in_page, base_url):
    """BUG-2 e BUG-3: la cartella dice cosa c'è sotto, e spegne oltre che accendere.

    Prima l'interruttore di una cartella era permanentemente spento per costruzione,
    quindi il clic calcolava sempre `!false` e non esisteva alcun gesto che revocasse
    un sottoalbero.
    """
    page = logged_in_page
    ts = int(time.time())
    cat, func = f"E2E FolderCat {ts}", f"E2E FolderFunc {ts}"
    role_name = f"E2E FolderRole {ts}"

    # See test_roles_tree_follows_the_menu_tree above: the try starts before the
    # first creation so a setup failure partway through doesn't leak whatever
    # already succeeded with zero cleanup attempt.
    try:
        _create_category(page, base_url, cat)
        _create_functionality(page, base_url, func, f"/e2e-folder-{ts}")
        detail_url = _create_role(page, base_url, role_name)

        # Annida la funzionalità nella categoria, così la cartella ha una foglia sola:
        # con una foglia sola gli stati della cartella e della foglia coincidono, e
        # l'asserzione non dipende da cos'altro c'è nell'albero.
        nav(page, f"{base_url}/functionalities")
        page.get_by_text(func, exact=True).first.scroll_into_view_if_needed()
        row = page.locator("div").filter(has_text=func).filter(has=page.locator('[data-testid="nav-edit"]')).last
        row.locator('[data-testid="nav-edit"]').click()
        page.wait_for_url("**/edit", timeout=10_000)
        _pick_genitore(page, cat)
        page.get_by_role("button", name="Salva").click()
        page.wait_for_url("**/functionalities", timeout=10_000)

        nav(page, detail_url)
        cartella = _perm_row_toggle(page, cat)
        foglia = _perm_row_toggle(page, func)
        expect(cartella).to_have_attribute("aria-checked", "false")

        # Accendi dalla cartella: la foglia si accende e la cartella lo mostra.
        cartella.click()
        expect(foglia).to_have_attribute("aria-checked", "true")
        expect(cartella).to_have_attribute("aria-checked", "true")
        _save_and_wait(page, detail_url)
        nav(page, detail_url)
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "true")

        # Spegni dalla cartella: è il gesto che prima non esisteva.
        _perm_row_toggle(page, cat).click()
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "false")
        _save_and_wait(page, detail_url)
        nav(page, detail_url)
        expect(_perm_row_toggle(page, func)).to_have_attribute("aria-checked", "false")
        expect(_perm_row_toggle(page, cat)).to_have_attribute("aria-checked", "false")
    finally:
        _safe_delete_role(page, base_url, role_name)
        _safe_delete_functionality(page, base_url, func)
        _safe_delete_functionality(page, base_url, cat)


def test_deleted_functionality_disappears_from_roles(logged_in_page, base_url):
    """BUG-4: cancellare una voce non lascia dietro di sé una riga irraggiungibile.

    Prima una categoria cancellata lasciava in `permission` una riga che nessuna voce
    citava più, quindi nessun percorso di cancellazione poteva raggiungerla: compariva
    in Ruoli per sempre. Sul database di sviluppo erano tre categorie `E2E`, avanzo di
    vecchie esecuzioni di questa stessa suite.
    """
    page = logged_in_page
    ts = int(time.time())
    cat = f"E2E Vanish {ts}"
    role_name = f"E2E VanishRole {ts}"

    # The try starts before creation (see test_roles_tree_follows_the_menu_tree
    # above), and cat's cleanup lives ONLY in the finally, via the tolerant safety
    # net — not as a bare call in the body. The delete at line ~448 below is the
    # behaviour under test, not cleanup: if the sanity assertion just above it ever
    # failed — exactly what would happen if BUG-4 reappeared and the category never
    # reached the Roles tree — that line would never run, and a bare
    # `_delete_functionality(cat)` only in the body would leave cat permanently
    # orphaned: the very "unreachable orphaned row" symptom this test exists to
    # catch, reproduced on the test's own failure path.
    try:
        _create_category(page, base_url, cat)
        detail_url = _create_role(page, base_url, role_name)

        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True).first).to_be_visible()

        _delete_functionality(page, base_url, cat)

        nav(page, detail_url)
        expect(page.get_by_text(cat, exact=True)).to_have_count(0)
    finally:
        _safe_delete_role(page, base_url, role_name)
        _safe_delete_functionality(page, base_url, cat)
