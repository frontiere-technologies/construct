"""Un ruolo in sola lettura: vede le pagine, non i pulsanti di modifica.

E' il caso che ha motivato il catalogo dei permessi (piano 2026-10-12): far vedere la pagina
Funzionalita' a un utente senza permettergli di creare, modificare o eliminare voci.

Il ruolo si crea e si cancella con SQL diretto sul database di test, non dall'interfaccia: la
concessione e' il dato in prova, non il modo di farla.
"""
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
from playwright.sync_api import expect

from helpers import grid_rows, nav

REPO_ROOT = Path(__file__).resolve().parents[3]
ROLE_NAME = "zzz_e2e_sola_lettura"
ROLE_TYPE_SERVICE = 2


def _sql(query: str) -> None:
    try:
        subprocess.run(
            ["node", "sources/devops/db/db.mjs", "test-query", query],
            cwd=REPO_ROOT, check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"test-query failed: {query}\nstdout: {e.stdout}\nstderr: {e.stderr}"
        ) from e


def _assert_sent_home(page, base_url) -> None:
    """Il rifiuto e' un rimando alla home: non /login, non un'altra pagina."""
    page.wait_for_url(f"{base_url}/")
    assert urlparse(page.url).path == "/"


def _grant(code: str, role: str = ROLE_NAME) -> None:
    _sql(
        "insert into role_permission (id_role, id_permission) "
        f"select r.id_role, p.id_permission from role r, permission p "
        f"where r.description = '{role}' and p.code = '{code}' on conflict do nothing"
    )


def _revoke(code: str) -> None:
    _sql(
        "delete from role_permission "
        f"where id_role = (select id_role from role where description = '{ROLE_NAME}') "
        f"and id_permission = (select id_permission from permission where code = '{code}')"
    )


@pytest.fixture
def read_only_role(test_email_user):
    _sql(f"delete from role where description = '{ROLE_NAME}'")
    _sql(f"insert into role (description, id_role_type) values ('{ROLE_NAME}', {ROLE_TYPE_SERVICE})")
    try:
        _sql(
            "insert into user_role (user_id, id_role) "
            f"select u.id, r.id_role from users u, role r "
            f"where u.email = '{test_email_user}' and r.description = '{ROLE_NAME}'"
        )
        for code in ("read-menu", "read-roles", "read-languages"):
            _grant(code)
        yield
    finally:
        _sql(f"delete from role where description = '{ROLE_NAME}'")


def test_reader_sees_functionalities_without_edit_controls(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities")
    assert "/functionalities" in non_admin_page.url
    non_admin_page.wait_for_selector('[data-testid="open-filters"]')
    # Un nodo dell'albero deve essere gia' disegnato, o i conteggi a zero passerebbero a vuoto.
    expect(non_admin_page.get_by_text("Admin", exact=True).first).to_be_visible()
    for testid in ("create-functionality", "nav-add", "nav-edit", "nav-delete"):
        assert non_admin_page.locator(f'[data-testid="{testid}"]').count() == 0, testid


def test_reader_cannot_open_the_create_page(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities/create")
    _assert_sent_home(non_admin_page, base_url)


def test_reader_sees_roles_without_create(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/roles-permissions")
    assert "/roles-permissions" in non_admin_page.url
    grid_rows(non_admin_page).first.wait_for()
    assert non_admin_page.locator('[data-testid="create-role"]').count() == 0


def test_reader_sees_languages_without_create(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/admin/languages")
    assert "/admin/languages" in non_admin_page.url
    grid_rows(non_admin_page).first.wait_for()
    assert non_admin_page.locator('[data-testid="create-language"]').count() == 0


def test_reader_without_read_users_is_kept_out(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/user-management")
    _assert_sent_home(non_admin_page, base_url)


def test_revocation_takes_effect_without_new_login(non_admin_page, base_url, read_only_role):
    nav(non_admin_page, f"{base_url}/functionalities")
    assert "/functionalities" in non_admin_page.url
    _revoke("read-menu")
    nav(non_admin_page, f"{base_url}/functionalities")
    _assert_sent_home(non_admin_page, base_url)


def test_administrator_still_sees_edit_controls(logged_in_page, base_url):
    nav(logged_in_page, f"{base_url}/functionalities")
    logged_in_page.wait_for_selector('[data-testid="create-functionality"]')
    assert logged_in_page.locator('[data-testid="nav-add"]').count() > 0


def test_reader_api_answers_by_permission(non_admin_page, base_url, read_only_role):
    """La rotta della griglia chiede il proprio codice: read-roles apre roles-grid, non users-grid.

    La richiesta parte dal contesto della pagina, quindi con il cookie di sessione del lettore.
    """
    nav(non_admin_page, f"{base_url}/functionalities")
    users = non_admin_page.request.post(
        f"{base_url}/api/rbac/users-grid",
        data={"page": 0, "size": 50, "sort": "dateIns", "direction": "DESC"},
    )
    assert users.status == 403, users.text()
    roles = non_admin_page.request.post(
        f"{base_url}/api/rbac/roles-grid",
        data={"page": 0, "size": 50, "sort": "id", "direction": "ASC"},
    )
    assert roles.status == 200, roles.text()


MANAGER_ROLE = "zzz_e2e_delegato"
TARGET_ROLE = "zzz_e2e_bersaglio"
MANAGER_CODES = ("read-users", "assign-user-roles", "read-roles", "grant-role-permissions", "read-menu")


@pytest.fixture
def delegated_manager(test_email_user):
    """Un gestore delegato: assegna ruoli e concede permessi, ma solo quelli che ha (DEC-6, DEC-29).

    Accanto, un ruolo di servizio vuoto su cui provare la pagina di dettaglio.
    """
    roles = f"('{MANAGER_ROLE}', '{TARGET_ROLE}')"
    _sql(f"delete from role where description in {roles}")
    _sql(
        "insert into role (description, id_role_type) values "
        f"('{MANAGER_ROLE}', {ROLE_TYPE_SERVICE}), ('{TARGET_ROLE}', {ROLE_TYPE_SERVICE})"
    )
    try:
        _sql(
            "insert into user_role (user_id, id_role) "
            f"select u.id, r.id_role from users u, role r "
            f"where u.email = '{test_email_user}' and r.description = '{MANAGER_ROLE}'"
        )
        for code in MANAGER_CODES:
            _grant(code, MANAGER_ROLE)
        yield
    finally:
        _sql(f"delete from role where description in {roles}")


def _role_id(page, base_url, name: str) -> int:
    """L'id del ruolo, letto dalla rotta della griglia con la sessione della pagina (read-roles)."""
    response = page.request.post(
        f"{base_url}/api/rbac/roles-grid",
        data={"page": 0, "size": 50, "search": name},
    )
    assert response.status == 200, response.text()
    matches = [r["id"] for r in response.json()["elements"] if r["description"] == name]
    assert len(matches) == 1, matches
    return matches[0]


def test_delegated_manager_cannot_pick_roles_it_cannot_assign(non_admin_page, base_url, delegated_manager):
    page = non_admin_page
    nav(page, f"{base_url}/user-management")
    target_id = _role_id(page, base_url, TARGET_ROLE)
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()

    administrator = page.get_by_test_id("role-checkbox-1")
    expect(administrator).to_be_disabled()
    hint = page.locator("label").filter(has=administrator).get_attribute("title")
    assert hint and hint != "users.roles.not_assignable_hint", hint
    # Un ruolo senza concessioni si assegna: non c'e' niente che il gestore non abbia.
    expect(page.get_by_test_id(f"role-checkbox-{target_id}")).to_be_enabled()


def test_delegated_manager_cannot_switch_on_what_it_does_not_hold(non_admin_page, base_url, delegated_manager):
    page = non_admin_page
    nav(page, f"{base_url}/roles-permissions")
    target_id = _role_id(page, base_url, TARGET_ROLE)
    nav(page, f"{base_url}/roles-permissions/{target_id}")

    # Le etichette degli alberi sono in inglese (nota del Task 8): "Edit the menu" e' manage-menu.
    edit_menu = page.locator('[data-testid="perm-toggle"][aria-label="Edit the menu"]')
    expect(edit_menu).to_be_disabled()
    hint = edit_menu.get_attribute("title")
    assert hint and hint != "roles.detail.not_grantable_hint", hint
    expect(page.locator('[data-testid="perm-toggle"][aria-label="View the menu"]')).to_be_enabled()
