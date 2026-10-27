import os
import socket
import threading
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from playwright.sync_api import expect

from helpers import nav, l1_btn, ensure_l1_expanded, confirm_modal, run_sql

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
    confirm_modal(page, "Elimina")
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(name, exact=True)).to_have_count(0)


@pytest.fixture(scope="module")
def admin_module_page(browser, admin_storage_state):
    """An admin page that lives as long as the module, to create the embedded items
    once and delete them after the last test."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state)
    yield ctx.new_page()
    ctx.close()


@pytest.fixture(scope="module")
def embedded_item(admin_module_page, base_url):
    """Factory: the name of an EMBEDDED_PAGE menu item pointing at `link`, created the
    first time a test asks for that link and deleted at the end of the module.

    A menu entry shows only when one of the person's roles holds it (sidebar-adapter.ts,
    DEC-18), administrators included, so the item is granted to the Administrator role
    of the default tenant, with SQL: the grant is not what these tests are about, and a
    system role cannot be edited from the interface. No throwaway role, no assignment,
    no fresh login: the token's roles are re-read on every request (lib/auth.ts, the
    `jwt` callback), and test_permissions.py::test_revocation_takes_effect_without_new_login
    proves it end to end. Deleting the item removes the grant (on delete cascade).
    The non-administrator, who holds no grant on the item, is the one the authorization
    assertion needs.
    """
    created = {}  # link -> item name

    def _get(link):
        if link not in created:
            name = f"E2E Embed {uuid.uuid4().hex[:8]}"
            _create_embedded_functionality(admin_module_page, base_url, name, link)
            created[link] = name
            run_sql(
                "insert into role_functionality (id_role, id_menu_entry) "
                "select r.id_role, m.id_menu_entry from role r, menu_entry m "
                "where r.id_tenant = app_private.current_tenant_id() and r.system_key = 'TENANT_ADMIN' "
                f"and m.id_tenant = app_private.current_tenant_id() and m.name = '{name}'"
            )
        return created[link]

    yield _get

    for name in created.values():
        try:
            _delete_functionality(admin_module_page, base_url, name)
        except Exception as e:
            print(f"cleanup failed for item {name}: {e}")


def _open_from_sidebar(page, base_url, item_name):
    """Land on the home page (after the item exists, so the sidebar lists it) and
    return the item's L1 entry."""
    nav(page, f"{base_url}/")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    return l1_btn(l1, item_name)


def test_embedded_page_renders_iframe_when_allowed(embedded_item, logged_in_page, base_url):
    # The embeddability check intentionally rejects private/loopback targets to
    # prevent SSRF, so the positive E2E case must use a public origin. Confirm that
    # origin is actually serving and framable before asserting anything about the
    # application: otherwise a third-party outage reads as an application failure.
    _require_embeddable_target(PUBLIC_EMBED_URL)
    item_name = embedded_item(PUBLIC_EMBED_URL)
    page = logged_in_page
    _open_from_sidebar(page, base_url, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    expect(page.locator('[data-testid="embedded-iframe"]')).to_be_visible()
    expect(page.locator('[data-testid="embedded-iframe"]')).to_have_attribute("src", PUBLIC_EMBED_URL)
    expect(page.locator("aside").first).to_be_visible()


def test_embedded_page_redirects_when_not_authorized(embedded_item, logged_in_page, base_url, non_admin_page):
    """A user with no grant on the item cannot reach the embedded page.

    The administrator session is not suitable for this assertion because the
    Administrator role intentionally retains access to every menu item; it is used
    only to read the item's address from the sidebar.
    """
    item_name = embedded_item(PUBLIC_EMBED_URL)
    item_href = _open_from_sidebar(logged_in_page, base_url, item_name).get_attribute("href")
    assert item_href and item_href.startswith("/embedded/")

    non_admin_page.goto(f"{base_url}{item_href}")
    # The redirect is real (a server-side `redirect('/')`), but on a route hit for the
    # first time Next.js dev/Turbopack can still be compiling it, so `networkidle` can
    # fire before the redirect response actually lands. Poll for the final URL instead
    # of asserting immediately.
    non_admin_page.wait_for_url(lambda url: url.rstrip("/") == base_url.rstrip("/"), timeout=15_000)
    non_admin_page.wait_for_load_state("networkidle")
    assert non_admin_page.url.rstrip("/") == base_url.rstrip("/")


def test_embedded_page_shows_fallback_when_private_target_is_blocked(embedded_item, logged_in_page, base_url, probe_server):
    url = f"{probe_server}/blocked"
    item_name = embedded_item(url)
    page = logged_in_page
    _open_from_sidebar(page, base_url, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    notice = page.locator('[data-testid="embedded-blocked-open-new-tab"]')
    expect(notice).to_be_visible()
    assert notice.get_attribute("href") == url
