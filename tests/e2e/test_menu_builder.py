def test_add_and_delete_item(logged_in_page, base_url):
    import uuid
    page = logged_in_page
    label = f"TEST-ITEM-{uuid.uuid4().hex[:6]}"

    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")

    page.get_by_role("button", name="Add Item").click()
    page.locator('form input[type="text"]').first.wait_for(state="visible", timeout=5_000)

    page.locator('form input[type="text"]').first.fill(label)
    page.locator('form select').nth(1).select_option("main")
    page.locator('form input[type="text"]').nth(1).fill("/test-item")

    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")

    item_row = page.locator('[data-testid="menu-item-row"]', has_text=label).first
    item_row.wait_for(state="visible", timeout=5_000)
    assert item_row.is_visible(), f"{label} not found in list after save"

    delete_btn = item_row.locator('[data-testid="delete-item-btn"]')
    assert delete_btn.is_visible(), f"Delete button not found for {label}"

    page.on("dialog", lambda d: d.accept())
    delete_btn.click()
    page.wait_for_load_state("networkidle")

    remaining = page.locator('[data-testid="menu-item-row"]', has_text=label).count()
    assert remaining == 0, f"{label} still present after delete: {remaining} rows"
