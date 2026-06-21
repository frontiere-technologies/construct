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


def test_container_route_field_visible_and_saves(logged_in_page, base_url):
    import uuid
    page = logged_in_page
    label = f"TEST-CONT-{uuid.uuid4().hex[:6]}"

    page.goto(f"{base_url}/admin/menu-builder")
    page.wait_for_load_state("networkidle")

    # Switch type to container
    page.locator('form select').first.select_option("container")

    # Route/URL field must be visible
    route_input = page.locator('form input[type="text"]').nth(1)
    assert route_input.is_visible(), "Route/URL field not visible for container type"

    # Fill form and save
    page.locator('form input[type="text"]').first.fill(label)
    page.locator('form select').nth(1).select_option("main")
    route_input.fill("/support")
    page.get_by_role("button", name="Save Changes").click()
    page.wait_for_load_state("networkidle")

    # Verify item saved
    item_row = page.locator('[data-testid="menu-item-row"]', has_text=label).first
    item_row.wait_for(state="visible", timeout=5_000)
    assert item_row.is_visible(), f"{label} not found after save"

    # Edit it and verify route persisted
    item_row.locator('[data-testid="edit-item-btn"]').click()
    saved_route = page.locator('form input[type="text"]').nth(1).input_value()
    assert saved_route == "/support", f"Route not persisted, got: {saved_route!r}"

    # Cleanup
    page.on("dialog", lambda d: d.accept())
    item_row.locator('[data-testid="delete-item-btn"]').click()
    page.wait_for_load_state("networkidle")
