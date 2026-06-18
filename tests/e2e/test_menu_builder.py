def test_add_and_delete_item(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")

    page.get_by_role("button", name="Add Item").click()
    page.wait_for_timeout(300)

    page.locator('form input[type="text"]').first.fill("TEST-ITEM")
    page.locator('form select').nth(1).select_option("main")
    page.locator('form input[type="text"]').nth(1).fill("/test-item")

    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    item_row = page.locator(".flex.items-center.justify-between", has_text="TEST-ITEM")
    assert item_row.count() > 0, "TEST-ITEM not found in list after save"

    delete_btn = item_row.locator("button[class*='text-red-600']")
    assert delete_btn.count() > 0, "Delete button not found for TEST-ITEM"

    page.on("dialog", lambda d: d.accept())
    delete_btn.first.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    remaining = page.locator(".flex.items-center.justify-between", has_text="TEST-ITEM").count()
    assert remaining == 0, f"TEST-ITEM still present after delete: {remaining} rows"
