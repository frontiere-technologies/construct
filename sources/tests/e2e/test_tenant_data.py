"""Cancellazione definitiva di un tenant sintetico dalla console di prova."""
import re

import pytest
from playwright.sync_api import expect

from helpers import delete_people, nav, operator_env, run_db
from test_tenants import _create_tenant

SLUG = "e2e-permanent-erasure"
LABEL = "Elimina definitivamente"


@pytest.fixture
def tenant_to_erase():
    email = f"{SLUG}@example.test"
    run_db("test-tenant-delete", "--slug", SLUG)
    delete_people([email])
    tenant_id = _create_tenant(SLUG, "E2E erasure synthetic", email, f"{SLUG}.localhost")
    try:
        yield tenant_id
    finally:
        run_db("test-tenant-delete", "--slug", SLUG)
        run_db(
            "test-query",
            "set local role construct_owner; delete from public.platform_audit_event "
            f"where operation = 'tenant.delete' and object_id = '{tenant_id}'",
            env={"TEST_DATABASE_URL": operator_env()["TEST_MIGRATION_DATABASE_URL"]},
        )
        delete_people([email])


def test_archived_tenant_is_erased_after_typing_its_slug(platform_page, base_url, tenant_to_erase):
    page = platform_page
    tenant_url = f"{base_url}/platform/tenants/{tenant_to_erase}"
    nav(page, tenant_url)
    expect(page.get_by_role("heading", name="Dati", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name=LABEL, exact=True)).to_have_count(0)

    page.get_by_role("button", name="Archivia", exact=True).click()
    archive = page.get_by_role("dialog")
    archive.get_by_role("textbox").fill("Motivo sintetico da rimuovere")
    archive.get_by_role("button", name="Archivia", exact=True).click()
    expect(archive).to_have_count(0)
    expect(page.get_by_text("Archiviato", exact=True).first).to_be_visible()

    opener = page.get_by_role("button", name=LABEL, exact=True)
    opener.click()
    dialog = page.get_by_role("dialog", name="Eliminare definitivamente il tenant?")
    expect(dialog).to_contain_text("I file già esportati restano a chi li ha scaricati.")
    field = dialog.get_by_role("textbox", name=re.compile("digita lo slug attuale"))
    expect(field).to_be_focused()
    submit = dialog.get_by_role("button", name=LABEL, exact=True)
    expect(submit).to_be_disabled()
    field.fill("slug-sbagliato")
    expect(submit).to_be_disabled()
    field.press("Escape")
    expect(dialog).to_have_count(0)
    expect(opener).to_be_focused()

    downloads = []
    page.on("download", lambda download: downloads.append(download))
    opener.click()
    field.fill(SLUG)
    expect(submit).to_be_enabled()
    submit.click()
    page.wait_for_url(re.compile(rf"^{re.escape(base_url)}/platform(?:\?.*)?$"), timeout=15_000)
    expect(page.get_by_role("heading", name="Tenant", exact=True)).to_be_visible()
    assert not downloads
    assert page.request.get(tenant_url).status == 404

    response = page.request.post(f"{base_url}/api/platform/audit-grid", data={
        "page": 0, "size": 10, "operation": "tenant.delete",
    })
    assert response.ok
    event = next(row for row in response.json()["rows"] if row["objectId"] == str(tenant_to_erase))
    assert event["actorEmail"] is None
    assert event["actorUserId"]
    assert event["tenantId"] is None
    assert event["details"] == {}
