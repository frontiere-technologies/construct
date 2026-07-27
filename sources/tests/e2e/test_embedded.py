import socket
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from playwright.sync_api import expect

from helpers import nav, l1_btn, ensure_l1_expanded, grid_rows, open_column_filter, do_test_login


class _ProbeHandler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self._respond()

    def do_GET(self):
        self._respond()

    def _respond(self):
        body = b"probe" if self.command == "GET" else b""
        self.send_response(200)
        if self.path == "/blocked":
            self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, format, *args):
        pass


@pytest.fixture(scope="module")
def probe_server():
    # Bind on loopback, but hand out a URL using this machine's own mDNS/Bonjour hostname
    # (`socket.gethostname()`, e.g. "some-mac.local") rather than the literal "127.0.0.1" or
    # "localhost". The app's SSRF guard (lib/rbac/embedded-check.ts) blocks literal
    # loopback/private-IP hostnames in the target URL by design, so a bare 127.0.0.1 URL here
    # would always resolve to "not embeddable" regardless of response headers — using a real
    # hostname keeps this test server usable for the "embeddable" test cases too. This
    # hostname resolves quickly because it is this machine's own actively-advertised Bonjour
    # name (mDNS answers it directly); an arbitrary unregistered "*.local" /etc/hosts entry
    # would instead pay a multicast-timeout-then-fallback penalty of several seconds per
    # lookup, which exceeds checkEmbeddable's internal fetch timeout.
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ProbeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://{socket.gethostname()}:{port}"
    server.shutdown()
    thread.join()


def _select_tipologia(page, label: str):
    page.locator('[data-testid="select-tipologia"]').click()
    page.get_by_role("button", name=label, exact=True).first.click()


def _create_embedded_functionality(page, base_url, name, link):
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e embed")
    _select_tipologia(page, "Link esterno embedded (iframe)")
    page.get_by_placeholder("Link *").fill(link)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _delete_functionality(page, base_url, name):
    nav(page, f"{base_url}/functionalities")
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-delete"]')).last
    page.once("dialog", lambda d: d.accept())
    row.locator('[data-testid="nav-delete"]').click()
    page.wait_for_timeout(600)
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(name, exact=True)).to_have_count(0)


def _perm_tree_row(page, text):
    """The tree row on the /roles-permissions/[roleId] page whose label is `text`.

    Unlike the /functionalities tree, PermissionsTree renders NavigationTree
    without a `dnd` config, so no `[data-testid="drag-handle"]` exists there at
    all — every row instead always renders a `[data-testid="perm-toggle"]`
    (via `renderTrailing`), so that's the reliable discriminator here.
    """
    return page.locator("div").filter(has_text=text).filter(
        has=page.locator('[data-testid="perm-toggle"]')
    ).last


def _create_role(page, base_url, name):
    """Create a SERVICE (editable) role via the UI. Returns its numeric id."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/roles-permissions/**", timeout=15_000)
    return int(page.url.rstrip("/").rsplit("/", 1)[-1])


def _search_role(page, base_url, name):
    nav(page, f"{base_url}/roles-permissions")
    open_column_filter(page, "description")
    page.locator('.ag-filter input[type="text"]').first.fill(name)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")


def _delete_role(page, base_url, name):
    _search_role(page, base_url, name)
    row = grid_rows(page).filter(has_text=name)
    expect(row).to_be_visible()
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
    page.get_by_role("button", name="Elimina").click()
    page.get_by_role("button", name="Elimina").click()
    _search_role(page, base_url, name)
    expect(grid_rows(page).filter(has_text=name)).to_have_count(0)


def _grant_item_to_role(page, base_url, role_id, item_name):
    nav(page, f"{base_url}/roles-permissions/{role_id}")
    row = _perm_tree_row(page, item_name)
    row.scroll_into_view_if_needed()
    row.locator('[data-testid="perm-toggle"]').click()
    save_btn = page.get_by_role("button", name="Salva")
    save_btn.click()
    expect(save_btn).to_be_disabled()
    expect(save_btn).to_be_enabled()


def _set_role_checkbox(page, base_url, test_email, role_id, checked):
    """Open 'Gestisci ruoli' for the row matching test_email and check/uncheck role_id.

    The Users grid uses AG Grid's infinite row model, so `test_email`'s row isn't
    necessarily among the first block loaded (there are many seeded/leftover test
    users) — filter first. The email column itself has no AG Grid filter, but the
    "Utente" (firstName) column's filter maps server-side to an OR-ilike across
    firstName/lastName/email (see `applyUserFilters` in users-service.ts), so
    filtering it by the email still narrows to the right row.
    """
    nav(page, f"{base_url}/user-management")
    open_column_filter(page, "firstName")
    page.locator('.ag-filter input[type="text"]').first.fill(test_email)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    row = grid_rows(page).filter(has_text=test_email)
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    checkbox = page.get_by_test_id(f"role-checkbox-{role_id}")
    if checked:
        checkbox.check()
    else:
        checkbox.uncheck()
    page.get_by_test_id("save-roles").click()
    expect(page.get_by_test_id("save-roles")).to_have_count(0)


@pytest.fixture
def embedded_item_page(logged_in_page, base_url, browser, test_email):
    """Factory fixture: given a target link, creates a throwaway role + EMBEDDED_PAGE
    item, grants the item to the role, assigns the role to the test admin account,
    then logs in a *fresh* browser context (role membership is baked into the
    session JWT at sign-in and never refreshed, so verifying authorization requires
    a login that happens after the grant). Returns (item_name, fresh_page).
    Cleans up the role assignment, item, and role, and closes the fresh context.
    """
    created_roles = []  # (role_name, role_id)
    created_items = []  # item_name
    checked_role_ids = []  # role_id whose checkbox was set on the test user
    created_contexts = []  # browser contexts

    def _make(link):
        page = logged_in_page
        suffix = uuid.uuid4().hex[:8]
        role_name = f"E2E Embed Role {suffix}"
        item_name = f"E2E Embed {suffix}"

        role_id = _create_role(page, base_url, role_name)
        created_roles.append((role_name, role_id))

        _create_embedded_functionality(page, base_url, item_name, link)
        created_items.append(item_name)

        _grant_item_to_role(page, base_url, role_id, item_name)

        _set_role_checkbox(page, base_url, test_email, role_id, checked=True)
        checked_role_ids.append(role_id)

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        created_contexts.append(ctx)
        fresh_page = ctx.new_page()
        do_test_login(fresh_page, base_url, test_email)

        return item_name, fresh_page

    yield _make

    for ctx in created_contexts:
        try:
            ctx.close()
        except Exception as e:
            print(f"cleanup failed for context {ctx}: {e}")
    for role_id in checked_role_ids:
        try:
            _set_role_checkbox(logged_in_page, base_url, test_email, role_id, checked=False)
        except Exception as e:
            print(f"cleanup failed for role checkbox {role_id}: {e}")
    for item_name in created_items:
        try:
            _delete_functionality(logged_in_page, base_url, item_name)
        except Exception as e:
            print(f"cleanup failed for item {item_name}: {e}")
    for role_name, role_id in created_roles:
        try:
            _delete_role(logged_in_page, base_url, role_name)
        except Exception as e:
            print(f"cleanup failed for role {role_name} ({role_id}): {e}")


def test_embedded_page_renders_iframe_when_allowed(embedded_item_page, probe_server):
    item_name, page = embedded_item_page(f"{probe_server}/ok")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    expect(page.locator('[data-testid="embedded-iframe"]')).to_be_visible()
    expect(page.locator('[data-testid="embedded-iframe"]')).to_have_attribute("src", f"{probe_server}/ok")
    expect(page.locator("aside").first).to_be_visible()


def test_embedded_page_redirects_when_not_authorized(embedded_item_page, base_url, logged_in_page, probe_server):
    """The shared `logged_in_page` session does NOT have the throwaway role granted to
    the fresh session inside `embedded_item_page`, so it's already a ready-made
    "unauthorized" session for this exact item. Navigating it straight to the item's
    `/embedded/{id}` URL must redirect back to `/`, not render the iframe/fallback."""
    item_name, fresh_page = embedded_item_page(f"{probe_server}/ok")
    l1 = fresh_page.locator("aside").first
    ensure_l1_expanded(fresh_page, l1)
    item_href = l1_btn(l1, item_name).get_attribute("href")
    assert item_href and item_href.startswith("/embedded/")

    logged_in_page.goto(f"{base_url}{item_href}")
    # The redirect is real (a server-side `redirect('/')`), but on a route hit for the
    # first time Next.js dev/Turbopack can still be compiling it, so `networkidle` can
    # fire before the redirect response actually lands. Poll for the final URL instead
    # of asserting immediately.
    logged_in_page.wait_for_url(lambda url: url.rstrip("/") == base_url.rstrip("/"), timeout=15_000)
    logged_in_page.wait_for_load_state("networkidle")
    assert logged_in_page.url.rstrip("/") == base_url.rstrip("/")


def test_embedded_page_shows_fallback_when_blocked(embedded_item_page, probe_server):
    url = f"{probe_server}/blocked"
    item_name, page = embedded_item_page(url)
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    notice = page.locator('[data-testid="embedded-blocked-open-new-tab"]')
    expect(notice).to_be_visible()
    assert notice.get_attribute("href") == url
