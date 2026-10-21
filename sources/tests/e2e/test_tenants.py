"""Tenant per indirizzo (multi-tenancy, pezzo 4).

Gli indirizzi dedicati si provano in locale con i sottodomini di localhost
(`a.localhost`, `b.localhost`): i browser li mandano al computer locale senza
toccare /etc/hosts (specifica 2026-10-21, MT4-DEC-14).
"""
from urllib.parse import urlsplit

from helpers import do_test_login, nav


def _on_host(base_url: str, host: str) -> str:
    """Lo stesso server di `base_url`, raggiunto con un altro nome di host."""
    parts = urlsplit(base_url)
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}"


def test_login_stays_on_subdomain(browser, base_url, test_email):
    """Accesso e uscita restano sull'indirizzo della richiesta, mai su AUTH_URL (MT4-RISK-1).

    In questo pezzo il tenant è ancora quello predefinito: si verifica solo l'indirizzo.
    """
    a_url = _on_host(base_url, "a.localhost")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        do_test_login(page, a_url, test_email)
        assert page.url == f"{a_url}/", f"Expected {a_url}/, got {page.url}"
        session_cookies = [c for c in ctx.cookies() if "session-token" in c["name"]]
        assert session_cookies, "expected a session cookie after the login"
        assert {c["domain"] for c in session_cookies} == {"a.localhost"}, session_cookies

        page.locator('[data-testid="sidebar-account-button"]').click()
        page.get_by_role("button", name="Esci").or_(
            page.get_by_role("button", name="Logout")
        ).click()
        page.wait_for_url(f"{a_url}/login", timeout=15_000)
        assert page.url == f"{a_url}/login", f"Expected {a_url}/login, got {page.url}"

        # L'uscita ha davvero chiuso la sessione su questo indirizzo.
        page.goto(f"{a_url}/")
        page.wait_for_url(f"{a_url}/login", timeout=15_000)
    finally:
        ctx.close()


def test_failed_login_stays_on_subdomain(page, base_url):
    """Anche la pagina d'errore di un accesso fallito resta sull'indirizzo della richiesta (MT4-RISK-1)."""
    a_url = _on_host(base_url, "a.localhost")
    nav(page, f"{a_url}/login")
    page.locator('input[type="email"]').fill("nessuno-e2e@example.invalid")
    page.locator('input[type="password"]').fill("password-sbagliata")
    page.locator('button[type="submit"]').first.click()
    page.wait_for_url(f"{a_url}/login?error=*", timeout=15_000)
    assert page.url.startswith(f"{a_url}/login?error="), f"Expected {a_url}/login?error=…, got {page.url}"
