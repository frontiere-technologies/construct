import os
import socket
import threading
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from playwright.sync_api import expect

from helpers import nav, l1_btn, ensure_l1_expanded, grid_rows, open_column_filter, do_test_login

# Public endpoint with no frame-blocking response headers, needed because the
# embeddability check rejects private and loopback hosts to prevent SSRF.
#
# Was https://httpbin.org/html, which cost a red build: measured over repeated
# probes it alternated between HTTP 200, HTTP 503 from its load balancer, and no
# response at all, on both HEAD and GET. example.com answered 200 on 8 of 8
# attempts in ~90ms against httpbin's 1.6s when it answered, sends neither
# X-Frame-Options nor a CSP, is maintained by IANA for exactly this kind of use,
# and resolves to IPv4 answers only — which matters because the check pins the
# first DNS answer, so an IPv6 answer would be unroutable on a CI runner without
# an IPv6 route.
#
# Overridable so a target that goes bad can be swapped without editing this file.
PUBLIC_EMBED_URL = os.getenv("PUBLIC_EMBED_URL", "https://example.com/")


def _require_embeddable_target(url: str) -> None:
    """Skip, rather than fail, when the third-party positive target is not serving.

    The positive case needs a *public* origin: the embeddability check rejects
    private and loopback hosts to prevent SSRF, so the local probe server used by
    the negative cases cannot stand in for it. That leaves this one assertion
    depending on a site nobody in this repository controls — and it has already
    cost a red build once, with httpbin.org answering 503 from its load balancer.

    The probe deliberately goes straight to the target instead of inferring the
    state through the application, so an application regression stays visible: if
    the target is healthy and the app still shows the blocked notice, this returns
    and the test runs and fails, which is what should happen.
    """
    request = urllib.request.Request(
        url, method="GET", headers={"User-Agent": "Construct-E2E-Precondition/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, headers = response.status, response.headers
    except urllib.error.HTTPError as exc:
        pytest.skip(
            f"positive embed target {url} answered HTTP {exc.code}; "
            f"set PUBLIC_EMBED_URL to a healthy public page that allows framing"
        )
    except (urllib.error.URLError, OSError) as exc:
        pytest.skip(f"positive embed target {url} is unreachable ({exc})")

    if status // 100 != 2:
        pytest.skip(f"positive embed target {url} answered HTTP {status}")

    # If the target starts blocking framing, the app is right to show the notice and
    # this test's premise is gone. Skip with a message that says so, instead of
    # failing as though the application had regressed.
    xfo = (headers.get("X-Frame-Options") or "").upper()
    if "DENY" in xfo or "SAMEORIGIN" in xfo:
        pytest.skip(f"positive embed target {url} now sends X-Frame-Options: {xfo}")
    csp = headers.get("Content-Security-Policy") or ""
    if "frame-ancestors" in csp.lower():
        pytest.skip(f"positive embed target {url} now restricts framing via CSP frame-ancestors")


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
    """HTTP probe server used as an embed target for the /embedded tests.

    Binds all interfaces (`""`) rather than one resolved address, since the app
    server's `fetch` and Chromium each resolve `socket.gethostname()` via their own
    `getaddrinfo` and may pick a different address than a single pre-resolved IP.
    """
    hostname = socket.gethostname()
    server = ThreadingHTTPServer(("", 0), _ProbeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://{hostname}:{port}"
    server.shutdown()
    thread.join()


def _select_tipologia(page, label: str):
    page.locator('[data-testid="select-tipologia"]').click()
    page.get_by_role("listbox", name="Tipologia").get_by_role(
        "option", name=label, exact=True
    ).click()


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
    row.locator('[data-testid="nav-delete"]').click()
    # Deletion goes through this project's ConfirmModal, not a native dialog.
    # Scoped to the dialog: the row's own delete trigger carries the same
    # "Elimina" label and stays in the DOM behind the modal.
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_role("button", name="Elimina", exact=True).click()
    expect(dialog).to_have_count(0)
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
    expect(save_btn).to_be_disabled()
    expect(save_btn).to_be_enabled()


def _set_role_checkbox(page, base_url, test_email, role_id, checked):
    """Open 'Gestisci ruoli' for the row matching test_email and check/uncheck role_id.

    The Users grid uses AG Grid's infinite row model, so `test_email`'s row isn't
    necessarily among the first block loaded — filter the dedicated email column
    first so the exact account is loaded before opening its row menu.
    """
    nav(page, f"{base_url}/user-management")
    open_column_filter(page, "email")
    page.locator('.ag-filter input[type="text"]').first.fill(test_email)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")
    row = grid_rows(page).filter(has_text=test_email)
    row_menu = row.locator('[data-testid^="row-menu"]')
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


def test_embedded_page_renders_iframe_when_allowed(embedded_item_page):
    # The embeddability check intentionally rejects private/loopback targets to
    # prevent SSRF, so the positive E2E case must use a public origin. Confirm that
    # origin is actually serving and framable before asserting anything about the
    # application: otherwise a third-party outage reads as an application failure.
    _require_embeddable_target(PUBLIC_EMBED_URL)
    item_name, page = embedded_item_page(PUBLIC_EMBED_URL)
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    expect(page.locator('[data-testid="embedded-iframe"]')).to_be_visible()
    expect(page.locator('[data-testid="embedded-iframe"]')).to_have_attribute("src", PUBLIC_EMBED_URL)
    expect(page.locator("aside").first).to_be_visible()


def test_embedded_page_redirects_when_not_authorized(embedded_item_page, base_url, non_admin_page):
    """A user without the throwaway role cannot reach the embedded item.

    The shared administrator session is not suitable for this assertion because
    the Administrator role intentionally retains access to every menu item.
    """
    item_name, fresh_page = embedded_item_page(PUBLIC_EMBED_URL)
    l1 = fresh_page.locator("aside").first
    ensure_l1_expanded(fresh_page, l1)
    item_href = l1_btn(l1, item_name).get_attribute("href")
    assert item_href and item_href.startswith("/embedded/")

    non_admin_page.goto(f"{base_url}{item_href}")
    # The redirect is real (a server-side `redirect('/')`), but on a route hit for the
    # first time Next.js dev/Turbopack can still be compiling it, so `networkidle` can
    # fire before the redirect response actually lands. Poll for the final URL instead
    # of asserting immediately.
    non_admin_page.wait_for_url(lambda url: url.rstrip("/") == base_url.rstrip("/"), timeout=15_000)
    non_admin_page.wait_for_load_state("networkidle")
    assert non_admin_page.url.rstrip("/") == base_url.rstrip("/")


def test_embedded_page_shows_fallback_when_private_target_is_blocked(embedded_item_page, probe_server):
    url = f"{probe_server}/blocked"
    item_name, page = embedded_item_page(url)
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    notice = page.locator('[data-testid="embedded-blocked-open-new-tab"]')
    expect(notice).to_be_visible()
    assert notice.get_attribute("href") == url
