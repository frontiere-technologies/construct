"""Console della piattaforma (multi-tenancy, pezzo 5a, MT5-OK-2, MT5-OK-3, MT5-OK-5).

Un amministratore di piattaforma senza tenant (account dedicato, vedi `platform_admin_email` in
conftest.py: non TEST_EMAIL, o ogni altro test girerebbe come chi vede anche la console) arriva
sulla console, crea un tenant con il suo indirizzo dedicato, lo sospende e lo riattiva, e entra in
assistenza dopo il permesso dell'amministratore del tenant; ogni passo si vede nei registri.

Il tenant "E2E Console" vive su `e2e-console.localhost` (i sottodomini di localhost, come in
test_tenants.py) solo mentre girano i test di questo file: fixture `console`, con scope di modulo,
che lo toglie anche a ogni inizio di sessione (helpers.delete_e2e_tenants). La console esiste solo
sull'indirizzo principale (MT5-DEC-3): sull'indirizzo del tenant risponde come se non ci fosse.

Le email d'invito non si controllano in una casella: il test guarda che l'invio sia stato registrato
sul token (`helpers.invitation_delivery_status`), qualunque sia il fornitore dell'ambiente.

I test di questo file si seguono in ordine: dopo la creazione i successivi lavorano sullo stesso
tenant, e se la creazione fallisce si saltano.
"""
import re
import time
from types import SimpleNamespace

import pytest
from playwright.sync_api import expect

from helpers import (
    E2E_CONSOLE_TENANT_SLUG, delete_e2e_tenants, delete_people, grid_rows, invitation_delivery_status, nav,
)
from test_roles import _create_role
from test_tenants import _on_host, _signed_in

TENANT_NAME = "E2E Console"
HOST = "e2e-console.localhost"
SUSPENDED_MESSAGE = "Questo spazio è sospeso. Contatta il tuo amministratore."


@pytest.fixture(scope="module")
def console(test_email):
    """Il tenant creato dalla console e chi ci lavora; tolto alla fine anche se un test fallisce."""
    domain = test_email.split("@", 1)[1]
    state = SimpleNamespace(
        admin_email=f"e2e-console-admin@{domain}",
        tenant_id=None,
        role_name=f"E2E assistenza {int(time.time())}",
    )
    # Una esecuzione interrotta a metà può aver lasciato il tenant o l'account: si parte puliti.
    delete_e2e_tenants()
    delete_people([state.admin_email])
    try:
        yield state
    finally:
        delete_e2e_tenants()
        delete_people([state.admin_email])


def _console_home(base_url: str):
    """La casa della console, con o senza i parametri che la griglia scrive nell'indirizzo (ordinamento, filtri)."""
    return re.compile(rf"^{re.escape(base_url)}/platform(\?.*)?$")


def _need_tenant(console) -> None:
    if console.tenant_id is None:
        pytest.skip("il tenant di prova non è stato creato: vedi test_platform_admin_creates_a_tenant")


def _open_tenant_page(page, base_url, console) -> None:
    nav(page, f"{base_url}/platform/tenants/{console.tenant_id}")
    expect(page.get_by_role("heading", name="Dati")).to_be_visible()


def _confirm(page, label: str) -> None:
    """Conferma il dialogo che il comando ha appena aperto: il bottone con quel nome *dentro* il dialogo
    (nella pagina dietro ce n'è uno con lo stesso nome)."""
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_role("button", name=label, exact=True).click()
    expect(dialog).to_have_count(0)


def test_platform_admin_without_tenant_lands_on_the_console(platform_page, base_url):
    """L'amministratore di piattaforma senza tenant entra direttamente nella console (MT5-DEC-3)."""
    page = platform_page
    nav(page, f"{base_url}/")
    page.wait_for_url(_console_home(base_url), timeout=15_000)
    expect(page.get_by_role("heading", name="Tenant", exact=True)).to_be_visible()

    # Il tenant predefinito e il modello ci sono sempre, il modello con il suo segno.
    expect(grid_rows(page).filter(has_text="Default").first).to_be_visible(timeout=15_000)
    template = grid_rows(page).filter(has_text="Modello")
    expect(template.first).to_be_visible()
    expect(template.locator('[data-testid="tenant-template-badge"]')).to_have_count(1)

    # Le altre pagine della console, dalla barra laterale.
    for label in ("Amministratori", "Registro", "Lingue", "Traduzioni"):
        expect(page.locator("aside").get_by_role("link", name=label, exact=True)).to_be_visible()
    nav(page, f"{base_url}/platform/admins")
    expect(page.get_by_role("heading", name="Amministratori di piattaforma")).to_be_visible()
    expect(grid_rows(page).first.or_(page.get_by_text("Tu", exact=True)).first).to_be_visible()


def test_the_console_is_closed_to_tenant_people(logged_in_page, non_admin_page, base_url):
    """Un amministratore o un membro di tenant, anche se nessuno lo ferma prima, trova un 404 e un 403 (MT5-OK-2)."""
    for page in (logged_in_page, non_admin_page):
        for path in ("/platform", "/platform/admins", "/platform/audit", "/platform/languages"):
            response = page.goto(f"{base_url}{path}")
            assert response is not None and response.status == 404, f"{path} answered {response and response.status}"
        for path in ("/api/platform/tenants-grid", "/api/platform/audit-grid"):
            response = page.request.post(f"{base_url}{path}", data={"page": 0, "size": 10})
            assert response.status == 403, f"{path} returned {response.status}"


def test_platform_admin_creates_a_tenant(platform_page, base_url, console):
    """MT5-OK-3: il tenant nasce dalla console con il suo indirizzo, e l'invio dell'invito è registrato."""
    page = platform_page
    nav(page, f"{base_url}/platform")
    page.locator('[data-testid="new-tenant"]').click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_label("Nome", exact=True).fill(TENANT_NAME)
    # Lo slug si propone dal nome.
    expect(dialog.get_by_label("Slug")).to_have_value(E2E_CONSOLE_TENANT_SLUG)
    dialog.get_by_label("Indirizzo dedicato (facoltativo)").fill(HOST)
    dialog.get_by_label("Email del primo amministratore").fill(console.admin_email)
    dialog.get_by_role("button", name="Crea tenant", exact=True).click()

    # L'esito dell'invio: «riceve l'email» (status) o «non è partita» (alert), secondo il fornitore dell'ambiente.
    sent = dialog.get_by_role("status")
    failed = dialog.get_by_role("alert")
    expect(sent.or_(failed)).to_contain_text("Tenant creato", timeout=30_000)
    status = invitation_delivery_status(console.admin_email)
    assert status in ("sent", "failed"), f"l'invito non risulta registrato: {status!r}"
    if status == "sent":
        expect(sent).to_have_text("Tenant creato. Il primo amministratore riceve l'email d'invito.")
    else:
        expect(failed).to_contain_text("l'email d'invito non è partita")
    dialog.get_by_role("button", name="Chiudi", exact=True).click()
    expect(dialog).to_have_count(0)

    # Nell'elenco, attivo e con il suo indirizzo.
    row = grid_rows(page).filter(has_text=TENANT_NAME)
    expect(row).to_have_count(1, timeout=15_000)
    expect(row).to_contain_text(HOST)
    expect(row.locator('[data-testid="status-badge"]').or_(row.get_by_text("Attivo", exact=True))).to_be_visible()

    row.get_by_role("link", name=TENANT_NAME).click()
    page.wait_for_url(re.compile(r"/platform/tenants/\d+$"), timeout=15_000)
    console.tenant_id = int(page.url.rsplit("/", 1)[1])


def test_the_tenant_page_and_the_platform_audit_show_the_creation(platform_page, base_url, console):
    _need_tenant(console)
    page = platform_page
    _open_tenant_page(page, base_url, console)
    expect(page.get_by_text(HOST, exact=True)).to_be_visible()
    expect(page.get_by_text("Principale", exact=True)).to_be_visible()
    expect(page.get_by_text(console.admin_email, exact=True)).to_be_visible()
    # Il primo amministratore non ha ancora una password.
    expect(page.get_by_text("Invito in attesa")).to_be_visible()
    expect(page.get_by_role("button", name="Rimanda l'invito")).to_be_enabled()
    # Nessun permesso di assistenza: l'ingresso è chiuso, e la scheda dice perché.
    expect(page.get_by_text("Nessun permesso di assistenza.")).to_be_visible()
    expect(page.get_by_role("button", name="Entra come piattaforma")).to_be_disabled()

    nav(page, f"{base_url}/platform/audit")
    created = grid_rows(page).filter(has_text="Tenant creato").filter(has_text=TENANT_NAME)
    expect(created.first).to_be_visible(timeout=15_000)
    # Nel registro della piattaforma non compare nient'altro che i suoi eventi: niente voci di tenant.
    expect(grid_rows(page).filter(has_text="Ruolo creato")).to_have_count(0)


def test_the_console_does_not_exist_on_the_tenant_address(browser, base_url, console, platform_admin_email):
    """MT5-DEC-3: sull'indirizzo dedicato la console risponde come se non esistesse, anche a chi è amministratore di piattaforma."""
    _need_tenant(console)
    url = _on_host(base_url, HOST)
    with _signed_in(browser, url, platform_admin_email, landing=re.compile(r".*/no-tenant$")) as page:
        # La persona non appartiene al tenant: il messaggio, non la console.
        expect(page.locator('[data-testid="no-tenant-message"]')).to_be_visible()
        page.goto(f"{url}/platform")
        page.wait_for_url(f"{url}/no-tenant", timeout=15_000)
        response = page.request.post(f"{url}/api/platform/tenants-grid", data={"page": 0, "size": 10})
        assert response.status == 404, f"la rotta della console su {HOST} ha risposto {response.status}"
        response = page.request.post(f"{url}/api/platform/audit-grid", data={"page": 0, "size": 10})
        assert response.status == 404, f"la rotta del registro su {HOST} ha risposto {response.status}"


def test_suspending_a_tenant_shows_its_people_the_message_and_reactivating_lets_them_back(
    browser, platform_page, base_url, console,
):
    """MT5-OK-3: sospeso, chi lavora nel tenant lo trova chiuso alla richiesta dopo; riattivato, rientra con «Riprova»."""
    _need_tenant(console)
    url = _on_host(base_url, HOST)
    page = platform_page
    with _signed_in(browser, url, console.admin_email) as member:
        expect(member.locator('[data-testid="sidebar-account-button"]')).to_be_visible()

        _open_tenant_page(page, base_url, console)
        page.get_by_role("button", name="Sospendi", exact=True).click()
        _confirm(page, "Sospendi")
        expect(page.get_by_text("Sospeso", exact=True).first).to_be_visible(timeout=15_000)
        # Un tenant sospeso non riceve amministratori né inviti: i bottoni lo dicono.
        expect(page.get_by_role("button", name="Aggiungi amministratore")).to_be_disabled()

        member.goto(f"{url}/")
        member.wait_for_url(f"{url}/no-tenant", timeout=15_000)
        expect(member.locator('[data-testid="no-tenant-message"]')).to_have_text(SUSPENDED_MESSAGE, timeout=15_000)

        page.get_by_role("button", name="Riattiva", exact=True).click()
        _confirm(page, "Riattiva")
        expect(page.get_by_text("Attivo", exact=True).first).to_be_visible(timeout=15_000)

        member.get_by_role("button", name="Riprova").click()
        member.wait_for_url(f"{url}/", timeout=15_000)
        expect(member.locator('[data-testid="sidebar-account-button"]')).to_be_visible(timeout=15_000)


def test_support_with_consent_the_platform_edits_a_role_and_the_tenant_sees_it_in_its_audit(
    browser, platform_page, base_url, console,
):
    """MT5-OK-2: l'amministratore del tenant concede l'assistenza, la piattaforma entra con la fascia,
    modifica un ruolo ed esce; l'amministratore del tenant vede le voci nel suo registro."""
    _need_tenant(console)
    url = _on_host(base_url, HOST)
    page = platform_page
    with _signed_in(browser, url, console.admin_email) as admin:
        # Senza permesso la piattaforma non entra (il bottone è spento, già visto sopra); l'amministratore lo concede.
        nav(admin, f"{url}/admin/tenant-settings")
        expect(admin.locator('[data-testid="tenant-support-state"]')).to_have_text("L'assistenza non è consentita.")
        admin.get_by_role("button", name="1 ora", exact=True).click()
        expect(admin.locator('[data-testid="tenant-support-state"]')).to_contain_text("Assistenza consentita fino alle", timeout=15_000)

        # La piattaforma lo vede, entra con un motivo scritto e la home è quella del tenant, con la fascia.
        _open_tenant_page(page, base_url, console)
        expect(page.get_by_text("Permesso valido fino alle")).to_be_visible()
        enter = page.get_by_role("button", name="Entra come piattaforma")
        expect(enter).to_be_enabled()
        enter.click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Motivo").fill("E2E: verifica dei ruoli")
        dialog.get_by_role("button", name="Entra", exact=True).click()
        banner = page.locator('[data-testid="support-banner"]')
        expect(banner).to_be_visible(timeout=30_000)
        expect(banner).to_contain_text(f"Stai lavorando come piattaforma in {TENANT_NAME}")
        # Durante l'assistenza la console è chiusa: si lavora nel tenant e si esce dalla fascia.
        response = page.goto(f"{base_url}/platform")
        assert response is not None and response.status == 404, f"/platform in assistenza ha risposto {response and response.status}"
        nav(page, f"{base_url}/")
        expect(banner).to_be_visible()

        # Modifica un ruolo del tenant: con i permessi di un amministratore.
        _create_role(page, base_url, console.role_name)
        expect(banner).to_be_visible()

        # Esce: la fascia sparisce e si torna alla console.
        banner.get_by_role("button", name="Esci", exact=True).click()
        page.wait_for_url(_console_home(base_url), timeout=30_000)
        expect(page.locator('[data-testid="support-banner"]')).to_have_count(0)
        expect(page.get_by_role("heading", name="Tenant", exact=True)).to_be_visible()

        # L'amministratore del tenant vede le voci nel suo registro, con la veste della piattaforma.
        nav(admin, f"{url}/admin/audit")
        entered = grid_rows(admin).filter(has_text="Piattaforma entrata in assistenza")
        expect(entered.first).to_be_visible(timeout=15_000)
        role_row = grid_rows(admin).filter(has_text="Ruolo creato").filter(has_text="Piattaforma")
        expect(role_row.first).to_be_visible()
        exited = grid_rows(admin).filter(has_text="Piattaforma uscita dall'assistenza")
        expect(exited.first).to_be_visible()
        # La concessione l'ha fatta una persona del tenant, e sta nello stesso registro.
        expect(grid_rows(admin).filter(has_text="Assistenza consentita").first).to_be_visible()

        # Il ruolo è davvero lì, nel tenant.
        nav(admin, f"{url}/roles-permissions")
        expect(grid_rows(admin).first).to_be_visible(timeout=15_000)

    # La piattaforma ha le sue voci nel registro della console, con il tenant toccato.
    nav(page, f"{base_url}/platform/audit")
    expect(grid_rows(page).filter(has_text="Piattaforma entrata in assistenza").filter(has_text=TENANT_NAME).first).to_be_visible(timeout=15_000)
    expect(grid_rows(page).filter(has_text="Stato del tenant modificato").filter(has_text=TENANT_NAME).first).to_be_visible()
    # Ma non ci sono le modifiche fatte dentro il tenant: il ruolo creato sta solo nel registro del tenant (MT5-OK-2).
    expect(grid_rows(page).filter(has_text="Ruolo creato")).to_have_count(0)
