"""T08: sospensione reversibile, cancellazione esplicita e concorrenza delle policy.

Solo tenant e dati sintetici, con gli stessi fixture/helper della console.
I conteggi dal DB provano che Salva conserva le assegnazioni reali.
"""
import json
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

from helpers import E2E_CONSOLE_TENANT_SLUG, delete_people, grid_rows, nav, run_db, run_sql
from test_functionalities import _select_tipologia
from test_tenants import _create_tenant, _on_host, _signed_in

ARTIFACTS = Path(__file__).resolve().parents[3] / ".superpowers/sdd/2026-10-30-multi-tenancy-piece-5b-platform/logs"


def _scalar(tenant_id: int, expression: str) -> int:
    output = run_sql(f"select set_config('app.tenant_id', '{tenant_id}', true); select ({expression})::int as n")
    matches = re.findall(r"│\s*0\s*│\s*(\d+)\s*│", output)
    assert matches, "synthetic count was not returned"
    return int(matches[-1])


def _assignments(tenant_id: int) -> int:
    return _scalar(tenant_id, "(select count(*) from role_permission) + (select count(*) from role_functionality)")


@pytest.fixture
def policy_tenant(test_email, base_url):
    email = f"e2e-console-admin@{test_email.split('@', 1)[1]}"
    run_db("test-tenant-delete", "--slug", E2E_CONSOLE_TENANT_SLUG)
    delete_people([email])
    tenant_id = _create_tenant(E2E_CONSOLE_TENANT_SLUG, "E2E policy synthetic", email, "e2e-console.localhost")
    origin = base_url.replace("'", "''")
    try:
        # L'owner crea il tenant col helper canonico; le assegnazioni sono normali scritture runtime.
        run_sql(f"""
          select set_config('app.tenant_id', '{tenant_id}', true);
          select set_config('app.menu_origin', '{origin}', true);
          delete from role_permission;
          delete from role_functionality;
          insert into role (id_role_type, description) values (2, 'E2E policy role');
          insert into role_permission (id_role, id_permission)
            select r.id_role, p.id_permission from role r cross join permission p
            where r.description = 'E2E policy role' and p.code = 'read-users';
          insert into menu_entry (name, id_functionality_type, functionality_link, order_position, is_immutable)
            values ('E2E policy people', 3, '/user-management', 0, 0);
          insert into role_functionality (id_role, id_menu_entry)
            select r.id_role, m.id_menu_entry from role r cross join menu_entry m
            where r.description = 'E2E policy role' and m.name = 'E2E policy people';
        """)
        yield tenant_id
    finally:
        run_db("test-tenant-delete", "--slug", E2E_CONSOLE_TENANT_SLUG)
        delete_people([email])


def _open(page, base_url, tenant_id):
    nav(page, f"{base_url}/platform/tenants/{tenant_id}")
    editor = page.get_by_role("heading", name="Concessioni e limiti", exact=True).locator("..")
    expect(editor).to_be_visible()
    return editor


def _save(editor):
    editor.get_by_role("button", name="Salva", exact=True).click()
    expect(editor.get_by_role("button", name="Salva", exact=True)).to_be_enabled()


def test_export_requires_tenant_admin_or_explicit_support_consent(
    browser, platform_page, non_admin_page, base_url, policy_tenant, test_email,
):
    """T10: archivio privato solo ad admin o assistenza valida con estensione esplicita."""
    endpoint = f"{base_url}/api/tenant/export"
    for page in (non_admin_page, platform_page):
        denied = page.request.get(endpoint)
        assert denied.status == 403
        assert "content-disposition" not in denied.headers

    admin_email = f"e2e-console-admin@{test_email.split('@', 1)[1]}"
    tenant_url = _on_host(base_url, "e2e-console.localhost")

    def enter_support():
        nav(platform_page, f"{base_url}/platform/tenants/{policy_tenant}")
        platform_page.get_by_role("button", name="Entra come piattaforma").click()
        dialog = platform_page.get_by_role("dialog")
        dialog.get_by_label("Motivo").fill("E2E synthetic data archive")
        dialog.get_by_role("button", name="Entra", exact=True).click()
        expect(platform_page.locator('[data-testid="support-banner"]')).to_be_visible(timeout=30_000)
        nav(platform_page, f"{base_url}/admin/tenant-settings")

    def download_archive(page):
        with page.expect_download() as event:
            page.get_by_role("button", name="Scarica archivio JSON", exact=True).click()
        download = event.value
        assert download.failure() is None
        archive = json.loads(Path(download.path()).read_text())
        assert archive["formatVersion"] == 1
        assert archive["schemaVersion"] == "0070"
        assert archive["sourceTenant"]["id"] == str(policy_tenant)
        for name, rows in archive["tables"].items():
            assert archive["counts"][name] == len(rows)
            assert all(row["id_tenant"] == str(policy_tenant) for row in rows)
        assert all("is_platform_admin" not in identity and "password_hash" not in identity for identity in archive["identities"])

    with _signed_in(browser, tenant_url, admin_email) as admin:
        nav(admin, f"{tenant_url}/admin/tenant-settings")
        download_archive(admin)
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        admin.get_by_role("heading", name="Esportazione dei dati", exact=True).locator("..").screenshot(
            path=str(ARTIFACTS / "t10-export-control.png")
        )

        # Il consenso di assistenza ordinario non conferisce l'esportazione.
        admin.get_by_role("button", name="1 ora", exact=True).click()
        expect(admin.locator('[data-testid="tenant-support-state"]')).to_contain_text("Assistenza consentita fino alle")
        enter_support()
        expect(platform_page.get_by_role("button", name="Scarica archivio JSON", exact=True)).to_have_count(0)
        denied = platform_page.request.get(endpoint)
        assert denied.status == 403
        assert "content-disposition" not in denied.headers
        platform_page.locator('[data-testid="support-banner"]').get_by_role("button", name="Esci", exact=True).click()
        platform_page.wait_for_url(re.compile(rf"^{re.escape(base_url)}/platform(\?.*)?$"), timeout=30_000)

        # Ogni rinnovo richiede una scelta nuova; questa volta è esplicita.
        admin.get_by_label("Consenti anche l’esportazione dei dati", exact=True).check()
        admin.get_by_role("button", name="1 ora", exact=True).click()
        expect(admin.get_by_text("Esportazione consentita durante l’assistenza autorizzata.", exact=True)).to_be_visible()
        enter_support()
        download_archive(platform_page)

        # Revoca già valida sul server: niente allegato nemmeno con la vecchia pagina ancora aperta.
        admin.get_by_role("button", name="Revoca", exact=True).click()
        expect(admin.locator('[data-testid="tenant-support-state"]')).to_have_text("L'assistenza non è consentita.")
        denied = platform_page.request.get(endpoint)
        assert denied.status == 403
        assert "content-disposition" not in denied.headers


def test_suspend_restore_and_purge_grants(platform_page, base_url, policy_tenant):
    page = platform_page
    editor = _open(page, base_url, policy_tenant)
    before = _assignments(policy_tenant)
    assert before == 2
    editor.locator('input[data-area="people"]').uncheck()
    _save(editor)
    expect(editor.get_by_text("Pulizia delle assegnazioni sospese", exact=True)).to_be_visible()
    assert _assignments(policy_tenant) == before, "Salva must never purge assignments"
    editor.locator('input[data-area="people"]').check()
    _save(editor)
    expect(editor.get_by_text("Pulizia delle assegnazioni sospese", exact=True)).to_have_count(0)
    assert _assignments(policy_tenant) == before, "Restoring features must retain assignments"
    editor.locator('input[data-area="people"]').uncheck()
    _save(editor)
    editor.locator('input[data-purge-area="people"]').check()
    editor.get_by_role("button", name="Calcola anteprima pulizia", exact=True).click()
    editor.get_by_role("button", name="Rivedi cancellazione assegnazioni", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Ruoli coinvolti: 1. Assegnazioni permessi: 1. Assegnazioni menu: 1.")
    assert _assignments(policy_tenant) == before, "Preview and opening confirmation must preserve grants"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    dialog.screenshot(path=str(ARTIFACTS / "t08-purge-confirmation.png"))
    dialog.get_by_role("button", name="Elimina le assegnazioni indicate", exact=True).click()
    expect(dialog).to_have_count(0)
    assert _assignments(policy_tenant) == 0
    assert _scalar(policy_tenant, "select count(*) from role where description = 'E2E policy role'") == 1
    assert _scalar(policy_tenant, "select count(*) from menu_entry where name = 'E2E policy people'") == 1


def test_policy_conflict_and_quota_notice(platform_page, base_url, policy_tenant):
    first = platform_page
    second = first.context.new_page()
    try:
        editor_a = _open(first, base_url, policy_tenant)
        editor_b = _open(second, base_url, policy_tenant)
        editor_b.get_by_label("Massimo appartenenze", exact=True).fill("0")
        expect(editor_b.get_by_text(re.compile("Il limite è inferiore"))).to_be_visible()
        editor_a.locator('input[data-area="appearance"]').uncheck()
        _save(editor_a)
        editor_b.get_by_role("button", name="Salva", exact=True).click()
        expect(editor_b.get_by_role("alert")).to_contain_text("La revisione è cambiata")
        expect(editor_b.get_by_role("button", name="Salva", exact=True)).to_be_disabled()
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        editor_b.get_by_role("alert").screenshot(path=str(ARTIFACTS / "t08-conflict.png"))
        editor_b.get_by_label("Massimo appartenenze", exact=True).locator("..").screenshot(
            path=str(ARTIFACTS / "t08-quota-notice.png")
        )
        editor_b.get_by_role("button", name="Ricarica dati", exact=True).click()
        expect(editor_b.get_by_role("button", name="Salva", exact=True)).to_be_enabled()
        expect(editor_b.locator('input[data-area="appearance"]')).not_to_be_checked()
        editor_b.get_by_label("Massimo appartenenze", exact=True).fill("0")
        _save(editor_b)
        expect(editor_b.get_by_text(re.compile("Il limite è inferiore"))).to_be_visible()
        assert _scalar(policy_tenant, "select count(*) from tenant_membership") >= 1
    finally:
        second.close()


def test_role_quota_rejection_refreshes_the_grid_and_keeps_the_dialog(
    browser, platform_page, base_url, policy_tenant, test_email,
):
    admin_email = f"e2e-console-admin@{test_email.split('@', 1)[1]}"
    tenant_url = _on_host(base_url, "e2e-console.localhost")
    with _signed_in(browser, tenant_url, admin_email) as admin:
        nav(admin, f"{tenant_url}/roles-permissions")
        admin.get_by_test_id("create-role").click()
        dialog = admin.get_by_role("dialog")
        dialog.get_by_placeholder("Nome ruolo").fill("E2E blocked role")

        run_sql(f"""
          select set_config('app.tenant_id', '{policy_tenant}', true);
          insert into role (id_role_type, description) values (2, 'E2E role from another session');
        """)
        editor = _open(platform_page, base_url, policy_tenant)
        count = _scalar(policy_tenant, "select count(*) from role")
        editor.get_by_label("Massimo ruoli (inclusi quelli di sistema)", exact=True).fill(str(count))
        _save(editor)

        dialog.get_by_role("button", name="Salva", exact=True).click()
        expect(dialog.get_by_role("alert")).to_have_text("È stato raggiunto il limite di ruoli del tenant.")
        expect(grid_rows(admin).filter(has_text="E2E role from another session")).to_have_count(1)
        expect(dialog.get_by_role("alert")).to_be_visible()
        expect(dialog.get_by_placeholder("Nome ruolo")).to_have_value("E2E blocked role")
        assert _scalar(policy_tenant, "select count(*) from role") == count


def test_template_quota_rejection_is_localized_and_atomic(platform_page, base_url):
    page = platform_page
    model_id = _scalar(1, "select id from tenant where is_template")
    slug = "e2e-copy-quota-blocked"
    host = f"{slug}.localhost"
    email = f"{slug}@example.test"
    editor = _open(page, base_url, model_id)
    limit = editor.get_by_label("Massimo ruoli (inclusi quelli di sistema)", exact=True)
    previous = limit.input_value()
    try:
        limit.fill("0")
        _save(editor)
        nav(page, f"{base_url}/platform")
        page.get_by_test_id("new-tenant").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Nome", exact=True).fill("E2E copy quota blocked")
        expect(dialog.get_by_label("Slug", exact=True)).to_have_value(slug)
        dialog.get_by_label("Indirizzo dedicato (facoltativo)").fill(host)
        dialog.get_by_label("Email del primo amministratore").fill(email)
        dialog.get_by_role("button", name="Crea tenant", exact=True).click()
        expect(dialog.get_by_role("alert")).to_have_text("Il limite di ruoli del modello non consente di creare il tenant.")
        assert _scalar(1, f"select count(*) from tenant where slug = '{slug}'") == 0
        assert _scalar(1, f"select count(*) from tenant_host where host = '{host}'") == 0
        assert _scalar(1, f"select count(*) from users where email = '{email}'") == 0
    finally:
        editor = _open(page, base_url, model_id)
        editor.get_by_label("Massimo ruoli (inclusi quelli di sistema)", exact=True).fill(previous)
        _save(editor)
        run_db("test-tenant-delete", "--slug", slug)
        delete_people([email])


def test_menu_and_member_quota_rejections_keep_the_inputs(
    browser, platform_page, base_url, policy_tenant, test_email, test_email_user,
):
    admin_email = f"e2e-console-admin@{test_email.split('@', 1)[1]}"
    unknown_email = "e2e-quota-unknown@example.test"
    tenant_url = _on_host(base_url, "e2e-console.localhost")
    menu_count = _scalar(policy_tenant, "select count(*) from menu_entry")
    member_count = _scalar(policy_tenant, "select count(*) from tenant_membership")
    editor = _open(platform_page, base_url, policy_tenant)
    editor.get_by_label("Massimo voci menu (incluse categorie)", exact=True).fill(str(menu_count))
    editor.get_by_label("Massimo appartenenze", exact=True).fill(str(member_count))
    _save(editor)

    try:
        with _signed_in(browser, tenant_url, admin_email) as admin:
            nav(admin, f"{tenant_url}/functionalities/create")
            name = admin.get_by_placeholder("Nome funzionalità *")
            name.fill("E2E blocked menu entry")
            admin.get_by_placeholder("Descrizione *").fill("E2E menu quota")
            _select_tipologia(admin, "Category")
            admin.get_by_role("button", name="Salva", exact=True).click()
            message = "È stato raggiunto il limite di voci di menu del tenant."
            expect(admin.get_by_role("alert").filter(has_text=message)).to_have_text(message)
            expect(name).to_have_value("E2E blocked menu entry")
            assert _scalar(policy_tenant, "select count(*) from menu_entry") == menu_count

            nav(admin, f"{tenant_url}/user-management")
            admin.get_by_role("button", name="Aggiungi persona", exact=True).click()
            dialog = admin.get_by_role("dialog")
            for email in (test_email_user, unknown_email):
                dialog.get_by_label("Email", exact=True).fill(email)
                dialog.get_by_role("button", name="Aggiungi", exact=True).click()
                expect(dialog.get_by_role("alert")).to_have_text("È stato raggiunto il limite di appartenenze del tenant.")
                expect(dialog.get_by_label("Email", exact=True)).to_have_value(email)
            assert _scalar(policy_tenant, "select count(*) from tenant_membership") == member_count
            assert _scalar(1, f"select count(*) from users where email = '{unknown_email}'") == 0
    finally:
        delete_people([unknown_email])
