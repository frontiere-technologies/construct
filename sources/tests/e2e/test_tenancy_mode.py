"""Exercise the configured mode of a separately started web process."""
import os

from playwright.sync_api import expect

from test_tenants import DEFAULT_TENANT_ID, _signed_in


def test_default_export_and_platform_access_follow_the_server_mode(
    browser, base_url, logged_in_page, non_admin_page, platform_admin_email,
):
    mode = os.environ.get("CONSTRUCT_TENANCY_MODE", "multi")
    assert mode in ("multi", "single")
    export_url = f"{base_url}/api/tenant/export"
    archive = logged_in_page.request.get(export_url)
    assert archive.status == 200
    assert archive.json()["sourceTenant"]["id"] == str(DEFAULT_TENANT_ID)
    denied = non_admin_page.request.get(export_url)
    assert denied.status == 403
    assert "content-disposition" not in denied.headers

    landing = "/platform" if mode == "multi" else "/no-tenant"
    with _signed_in(browser, base_url, platform_admin_email, landing=landing) as page:
        response = page.request.post(f"{base_url}/api/platform/tenants-grid", data={"page": 0, "size": 10})
        assert response.status == (200 if mode == "multi" else 403)
        if mode == "single":
            expect(page.get_by_test_id("no-tenant-message")).to_be_visible()
            assert page.request.get(export_url).status == 403
