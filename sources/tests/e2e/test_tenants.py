"""Tenant per indirizzo (multi-tenancy, pezzo 4).

Gli indirizzi dedicati si provano in locale con i sottodomini di localhost
(`a.localhost`, `b.localhost`): i browser li mandano al computer locale senza
toccare /etc/hosts (specifica 2026-10-21, MT4-DEC-14).

I tenant di prova vivono solo mentre girano i test di questo file (fixture
`tenants`, con scope di modulo): "E2E A" su `a.localhost`, "E2E B" su
`b.localhost`, "E2E C" senza indirizzo, cioè sull'indirizzo principale insieme
al predefinito. Fuori da qui `TEST_EMAIL` ha un solo tenant sull'indirizzo
principale, come si aspettano gli altri file (MT4-OK-1): con C presente per
tutta l'esecuzione, ogni accesso degli altri file finirebbe sulla pagina di
scelta.

I cookie sono per indirizzo: ogni indirizzo ha il suo accesso, in un contesto
del browser suo.
"""
import re
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import expect

from helpers import E2E_TENANT_SLUGS, delete_e2e_tenants, do_test_login, grid_rows, nav, run_db as _db

VIEWPORT = {"width": 1440, "height": 900}

# Il predefinito nasce con la migrazione 0046: id 1, nome "Default".
DEFAULT_TENANT_ID = 1
DEFAULT_TENANT_NAME = "Default"
# Gli slug stanno in helpers.py perché anche conftest.py li cancella all'inizio di ogni sessione.
SLUG_A, SLUG_B, SLUG_C = E2E_TENANT_SLUGS
NAME_A, HOST_A = "E2E A", "a.localhost"
NAME_B, HOST_B = "E2E B", "b.localhost"
NAME_C = "E2E C"

NO_TENANT_MESSAGE = "Non sei configurato su questo indirizzo."
REGISTER_CONFIRM = "Se l'email è autorizzata riceverai un link per completare la registrazione."
SELF_REGISTRATION = "Accetta registrazioni autonome"


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


# --- Tenant di prova --------------------------------------------------------------------------


def _create_tenant(slug: str, name: str, admin: str, host: str | None = None) -> int:
    args = ["test-tenant-create", "--slug", slug, "--name", name, "--admin", admin]
    if host:
        args += ["--host", host]
    found = re.search(r"Tenant creato: id=(\d+)", _db(*args))
    assert found, f"test-tenant-create non ha stampato l'id del tenant {slug}"
    return int(found.group(1))


def _account_count(email: str) -> int:
    """Quanti account ha l'indirizzo (0 o 1): `users` è globale e l'app la legge."""
    out = _db("test-query", f"select count(*)::int as n from users where email = '{email}'")
    found = re.search(r"│\s*0\s*│\s*(\d+)\s*│", out)
    assert found, out
    return int(found.group(1))


def _cleanup(people: list[str]) -> None:
    """Toglie i tenant e le persone di prova; idempotente, gira prima e dopo i test del file.

    Prima i tenant (con le loro appartenenze, un solo comando per i tre), poi gli account (una sola
    istruzione), poi l'ultimo tenant usato di TEST_EMAIL (test-reset-e2e): tre lanci di db.mjs
    invece di sette. Ogni passo prova anche se uno prima è fallito; gli errori si riportano tutti
    insieme alla fine.
    """
    errors = []
    try:
        delete_e2e_tenants()
    except Exception as error:  # noqa: BLE001 - si raccolgono e si riportano tutti
        errors.append(error)
    if people:  # `in ()` is a syntax error in SQL
        try:
            emails = ", ".join(f"'{email}'" for email in people)
            _db("test-query", f"delete from users where email in ({emails})")
        except Exception as error:  # noqa: BLE001
            errors.append(error)
    try:
        _db("test-reset-e2e")
    except Exception as error:  # noqa: BLE001
        errors.append(error)
    if errors:
        raise RuntimeError("; ".join(str(error) for error in errors))


@pytest.fixture(scope="module")
def tenants(test_email):
    """I tre tenant di prova e le persone che servono, tolti alla fine anche se un test fallisce.

    - `TEST_EMAIL`: amministratore di A, B e C, oltre che membro del predefinito.
    - `only_b`: un indirizzo nuovo, membro (amministratore) solo di B. Non si usa TEST_EMAIL_USER,
      che è già membro del predefinito.
    - `late`: un indirizzo nuovo, senza nessun tenant finché il test di «Riprova» non lo aggiunge ad A.
    - `register_a`: l'indirizzo per la registrazione da `a.localhost`, su un dominio ammesso e mai
      usato prima, perché la registrazione accoglie solo chi non appartiene a nessun tenant.
    """
    domain = test_email.split("@", 1)[1]
    people = SimpleNamespace(
        only_b=f"e2e-tenant-only-b@{domain}",
        late=f"e2e-tenant-late@{domain}",
        register_a=f"e2e-register-a-{uuid.uuid4().hex}@frontiere.io",
    )
    emails = [people.only_b, people.late, people.register_a]
    # Una esecuzione interrotta a metà può aver lasciato tenant o persone: si parte puliti.
    _cleanup(emails)
    try:
        ids = SimpleNamespace(
            a=_create_tenant(SLUG_A, NAME_A, test_email, HOST_A),
            b=_create_tenant(SLUG_B, NAME_B, test_email, HOST_B),
            c=_create_tenant(SLUG_C, NAME_C, test_email),
        )
        _db("test-tenant-member-add", "--slug", SLUG_B, "--email", people.only_b, "--admin")
        yield SimpleNamespace(ids=ids, people=people)
    finally:
        _cleanup(emails)


@contextmanager
def _signed_in(browser, url: str, email: str, landing="/"):
    """Un contesto nuovo, con l'accesso di prova fatto su `url`; si chiude all'uscita."""
    ctx = browser.new_context(viewport=VIEWPORT)
    try:
        page = ctx.new_page()
        do_test_login(page, url, email, landing=landing)
        page.wait_for_function("document.documentElement.dataset.appHydrated === 'true'", timeout=15_000)
        yield page
    finally:
        ctx.close()


def _expect_current_tenant(page, name: str) -> None:
    """Il nome del tenant corrente in cima alla barra laterale, aperta o compressa.

    Aperta, il nome è nel testo; compressa resta l'icona, con il nome intero nel suggerimento
    (`title`). Dopo un cambio di tenant la barra si ridisegna e torna per un attimo compressa finché
    non rilegge la preferenza salvata: un controllo che la apre prima di guardare può arrivare
    proprio in quell'attimo.
    """
    expect(page.locator(
        f'[data-testid="tenant-switcher-name"]:text-is("{name}"),'
        f' [data-testid="tenant-switcher-trigger"][title="{name}"],'
        f' [data-testid="tenant-switcher-current"][title="{name}"]'
    ), f"il tenant corrente dovrebbe essere {name}").to_have_count(1, timeout=10_000)


def _session_cookies(ctx) -> list:
    return [c for c in ctx.cookies() if "session-token" in c["name"]]


def _users_grid_emails(request, url: str) -> tuple[int, list[str]]:
    """La rotta della griglia utenti chiamata come un client qualsiasi, con i cookie del contesto."""
    response = request.post(f"{url}/api/rbac/users-grid", data={"page": 0, "size": 100})
    if response.status != 200:
        return response.status, []
    return 200, [user["email"] for user in response.json()["users"]]


# --- Indirizzo principale con due tenant (MT4-OK-2) -------------------------------------------


def test_choose_then_last_used(browser, base_url, test_email, tenants):
    """Primo accesso: la pagina di scelta con il predefinito e C; dal secondo, dritti nell'ultimo usato.

    A e B hanno un indirizzo dedicato, quindi sull'indirizzo principale non compaiono. Il "primo
    accesso" vale per l'ultimo tenant usato vuoto: lo si svuota qui, perché un test che si ripete o
    che gira dopo un altro (il cambio dalla barra lo scrive) non lo trova così.
    """
    _db("test-query", f"update users set last_tenant_id = null where email = '{test_email}'")
    with _signed_in(browser, base_url, test_email, landing="/select-tenant") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(re.compile(r"^Ciao .+, dove vuoi entrare\?$"))
        expect(page.get_by_test_id("tenant-card")).to_have_count(2)
        expect(page.get_by_test_id("tenant-name")).to_have_text([DEFAULT_TENANT_NAME, NAME_C])
        expect(page.get_by_test_id("tenant-card").filter(has_text=NAME_C)).to_contain_text("Amministratore")

        page.get_by_test_id("tenant-card").filter(has_text=NAME_C).click()
        page.wait_for_url(f"{base_url}/", timeout=15_000)
        _expect_current_tenant(page, NAME_C)

    with _signed_in(browser, base_url, test_email) as page:
        assert page.url == f"{base_url}/", page.url
        _expect_current_tenant(page, NAME_C)


def test_switch_from_sidebar(browser, base_url, test_email, test_email_user, tenants):
    """Da C il selettore elenca il predefinito e C, non A né B; il cambio porta alla home del predefinito.

    Le persone di C e del predefinito sono diverse (TEST_EMAIL_USER è solo nel predefinito): la pagina
    Utenti mostra quelle del tenant scelto. Il cambio aggiorna l'ultimo tenant usato.
    """
    ids = tenants.ids
    with _signed_in(browser, base_url, test_email, landing=re.compile(r".*/(select-tenant)?$")) as page:
        if page.url.endswith("/select-tenant"):
            page.get_by_test_id("tenant-card").filter(has_text=NAME_C).click()
            page.wait_for_url(f"{base_url}/", timeout=15_000)
        _expect_current_tenant(page, NAME_C)

        nav(page, f"{base_url}/user-management")
        expect(grid_rows(page).filter(has_text=test_email).first).to_be_visible()
        expect(grid_rows(page).filter(has_text=test_email_user)).to_have_count(0)

        page.get_by_test_id("tenant-switcher-trigger").click()
        options = page.locator('[data-testid^="tenant-switcher-option-"]')
        expect(options).to_have_text([DEFAULT_TENANT_NAME, NAME_C])
        expect(page.get_by_test_id(f"tenant-switcher-option-{ids.a}")).to_have_count(0)
        expect(page.get_by_test_id(f"tenant-switcher-option-{ids.b}")).to_have_count(0)

        page.get_by_test_id(f"tenant-switcher-option-{DEFAULT_TENANT_ID}").click()
        page.wait_for_url(f"{base_url}/", timeout=15_000)
        _expect_current_tenant(page, DEFAULT_TENANT_NAME)

        nav(page, f"{base_url}/user-management")
        expect(grid_rows(page).filter(has_text=test_email_user).first).to_be_visible()

    with _signed_in(browser, base_url, test_email) as page:
        _expect_current_tenant(page, DEFAULT_TENANT_NAME)


# --- Indirizzi dedicati (MT4-OK-3) -------------------------------------------------------------


def test_subdomains_are_separate(browser, base_url, test_email, tenants):
    """Su `a.localhost` TEST_EMAIL vede solo A e nessun elenco, su `b.localhost` solo B; chi è solo in B,
    su `a.localhost`, vede il messaggio e con «Esci» torna all'accesso dello stesso indirizzo."""
    for host, name, others in ((HOST_A, NAME_A, (NAME_B, NAME_C)), (HOST_B, NAME_B, (NAME_A, NAME_C))):
        with _signed_in(browser, _on_host(base_url, host), test_email) as page:
            _expect_current_tenant(page, name)
            expect(page.get_by_test_id("tenant-switcher-current")).to_be_visible()
            expect(page.get_by_test_id("tenant-switcher-trigger")).to_have_count(0)
            for other in others:
                expect(page.get_by_text(other, exact=True)).to_have_count(0)

    a_url = _on_host(base_url, HOST_A)
    with _signed_in(browser, a_url, tenants.people.only_b, landing="/no-tenant") as page:
        expect(page.get_by_test_id("no-tenant-message")).to_have_text(NO_TENANT_MESSAGE)
        expect(page.get_by_text(NAME_B)).to_have_count(0)
        page.get_by_role("button", name="Esci", exact=True).click()
        page.wait_for_url(f"{a_url}/login", timeout=15_000)
        page.goto(f"{a_url}/")
        page.wait_for_url(f"{a_url}/login", timeout=15_000)

    # La stessa persona su b.localhost entra in B: il messaggio dipende dall'indirizzo, non dall'account.
    with _signed_in(browser, _on_host(base_url, HOST_B), tenants.people.only_b) as page:
        _expect_current_tenant(page, NAME_B)


def _click_retry(page, url: str) -> None:
    """«Riprova» e l'attesa della sua azione del server: la richiesta POST che parte dal clic."""
    with page.expect_response(lambda r: r.request.method == "POST" and r.url.startswith(url)):
        page.get_by_role("button", name="Riprova", exact=True).click()


def test_not_configured_retry_without_tenant(browser, base_url, tenants):
    """«Riprova» senza nessun tenant sull'indirizzo: non si carica niente, il messaggio e l'indirizzo restano.

    La persona è quella solo di B: su `a.localhost` non ha tenant, e nessun test ve la aggiunge.
    """
    a_url = _on_host(base_url, HOST_A)
    with _signed_in(browser, a_url, tenants.people.only_b, landing="/no-tenant") as page:
        _click_retry(page, a_url)
        expect(page.get_by_role("button", name="Riprova", exact=True)).to_be_enabled()
        expect(page.get_by_test_id("no-tenant-message")).to_have_text(NO_TENANT_MESSAGE)
        expect(page.locator('[data-testid^="tenant-switcher-"]')).to_have_count(0)
        expect(page).to_have_url(f"{a_url}/no-tenant")


def test_not_configured_retry_after_joining(browser, base_url, tenants):
    """«Riprova» dopo l'aggiunta ad A, avvenuta mentre la persona guardava il messaggio: si entra in A
    senza rifare l'accesso.

    La home la carica il browser, sull'indirizzo di A: un rinvio dell'azione la farebbe disegnare a
    Next con l'indirizzo del server, cioè senza tenant.
    """
    a_url = _on_host(base_url, HOST_A)
    late = tenants.people.late
    with _signed_in(browser, a_url, late, landing="/no-tenant") as page:
        _db("test-tenant-member-add", "--slug", SLUG_A, "--email", late)
        _click_retry(page, a_url)
        page.wait_for_url(f"{a_url}/", timeout=15_000)
        _expect_current_tenant(page, NAME_A)
        expect(page.get_by_test_id("no-tenant-message")).to_have_count(0)


def test_token_from_b_on_a(browser, base_url, test_email, tenants):
    """Lo stato d'accesso preso su `b.localhost`, presentato a `a.localhost`, non dà i dati di B
    (Review Focus #1, MT4-OK-4).

    Il cookie si copia a mano su `a.localhost`, come farebbe un client che non è un browser; le
    stesse richieste si fanno anche fuori dalla pagina, con la rotta della griglia utenti.
    """
    a_url, b_url = _on_host(base_url, HOST_A), _on_host(base_url, HOST_B)
    only_b = tenants.people.only_b

    # Chi è solo in B: su a.localhost il messaggio, e la rotta rifiuta.
    with _signed_in(browser, b_url, only_b) as b_page:
        status, emails = _users_grid_emails(b_page.request, b_url)
        assert status == 200 and only_b in emails, (status, emails)  # il token vale davvero per B
        cookies = _session_cookies(b_page.context)
        assert cookies, "nessun cookie di sessione su b.localhost"

    ctx = browser.new_context(viewport=VIEWPORT)
    try:
        ctx.add_cookies([{**c, "domain": HOST_A} for c in cookies])
        status, emails = _users_grid_emails(ctx.request, a_url)
        assert status == 403 and emails == [], (status, emails)
        session = ctx.request.get(f"{a_url}/api/auth/session").json()
        assert session["user"]["tenantState"] == "none", session
        assert session["user"]["tenantId"] is None, session

        page = ctx.new_page()
        page.goto(f"{a_url}/")
        page.wait_for_url(f"{a_url}/no-tenant", timeout=15_000)
        expect(page.get_by_test_id("no-tenant-message")).to_have_text(NO_TENANT_MESSAGE)
        expect(page.get_by_text(NAME_B)).to_have_count(0)
    finally:
        ctx.close()

    # TEST_EMAIL, membro di A e di B: su a.localhost lo stesso token entra in A, mai in B.
    with _signed_in(browser, b_url, test_email) as b_page:
        cookies = _session_cookies(b_page.context)

    ctx = browser.new_context(viewport=VIEWPORT)
    try:
        ctx.add_cookies([{**c, "domain": HOST_A} for c in cookies])
        status, emails = _users_grid_emails(ctx.request, a_url)
        assert status == 200 and test_email in emails and only_b not in emails, (status, emails)
        session = ctx.request.get(f"{a_url}/api/auth/session").json()
        assert session["user"]["tenantId"] == tenants.ids.a, session
        assert session["user"]["tenantName"] == NAME_A, session

        page = ctx.new_page()
        page.goto(f"{a_url}/")
        page.wait_for_url(f"{a_url}/", timeout=15_000)
        page.wait_for_function("document.documentElement.dataset.appHydrated === 'true'", timeout=15_000)
        _expect_current_tenant(page, NAME_A)
        expect(page.get_by_text(NAME_B, exact=True)).to_have_count(0)
    finally:
        ctx.close()


# --- Registrazione da un indirizzo dedicato (MT4-OK-5) ----------------------------------------


def _register(browser, url: str, email: str) -> None:
    """La registrazione da `url` con un contesto anonimo: la risposta è sempre la stessa."""
    ctx = browser.new_context(viewport=VIEWPORT)
    try:
        page = ctx.new_page()
        nav(page, f"{url}/register")
        page.locator('input[type="email"]').fill(email)
        page.locator('button[type="submit"]').click()
        expect(page.get_by_text(REGISTER_CONFIRM)).to_be_visible(timeout=15_000)
    finally:
        ctx.close()


def _set_switch(page, url: str, on: bool) -> None:
    """L'interruttore di A dalla pagina delle impostazioni del tenant, come il suo amministratore."""
    nav(page, f"{url}/admin/tenant-settings")
    switch = page.get_by_role("switch", name=SELF_REGISTRATION)
    if (switch.get_attribute("aria-checked") == "true") != on:
        switch.click()
    # Lo stato mostrato cambia solo quando il server ha salvato.
    expect(switch).to_have_attribute("aria-checked", "true" if on else "false", timeout=15_000)


def test_register_on_subdomain(browser, base_url, test_email, tenants):
    """Da `a.localhost`: con l'interruttore di A spento la risposta neutra e nessun account né
    appartenenza; acceso, la stessa risposta e la persona entra in A.

    L'indirizzo del link nell'email (su `a.localhost`) è verificato senza browser nel Task 8
    (lib/tenancy/tenant-base-url.integration.test.ts). Un solo invio di email, con l'interruttore acceso.
    """
    a_url = _on_host(base_url, HOST_A)
    email = tenants.people.register_a
    with _signed_in(browser, a_url, test_email) as admin:
        try:
            _set_switch(admin, a_url, on=False)
            _register(browser, a_url, email)
            assert _account_count(email) == 0
            nav(admin, f"{a_url}/user-management")
            expect(grid_rows(admin).filter(has_text=test_email).first).to_be_visible()
            expect(grid_rows(admin).filter(has_text=email)).to_have_count(0)

            _set_switch(admin, a_url, on=True)
            _register(browser, a_url, email)
            assert _account_count(email) == 1
            nav(admin, f"{a_url}/user-management")
            expect(grid_rows(admin).filter(has_text=email)).to_have_count(1)
        except BaseException:
            # Si rispegne comunque, ma un errore qui non deve coprire quello del test: A sparisce
            # alla fine del file in ogni caso.
            try:
                _set_switch(admin, a_url, on=False)
            except Exception:  # noqa: BLE001
                pass
            raise
        _set_switch(admin, a_url, on=False)
