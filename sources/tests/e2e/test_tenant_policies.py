"""T08: sospensione reversibile, cancellazione esplicita e concorrenza delle policy.

Solo tenant e dati sintetici, con gli stessi fixture/helper della console.
I conteggi dal DB provano che Salva conserva le assegnazioni reali.
"""
import json
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

from helpers import E2E_CONSOLE_TENANT_SLUG, delete_people, nav, run_db, run_sql
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
