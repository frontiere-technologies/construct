def ensure_l1_expanded(page, l1) -> None:
    """Expand L1 column if currently collapsed (icon-only = width < 100px)."""
    box = l1.bounding_box()
    if box and box["width"] < 100:
        l1.locator("button").first.click()
        page.wait_for_timeout(400)


def ensure_l1_collapsed(page, l1) -> None:
    """Collapse L1 column if currently expanded."""
    box = l1.bounding_box()
    if box and box["width"] >= 100:
        l1.locator("button").first.click()
        page.wait_for_timeout(400)


def l1_btn(l1, label: str):
    return l1.get_by_role("button", name=label, exact=True)
