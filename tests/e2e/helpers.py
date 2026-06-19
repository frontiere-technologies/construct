def ensure_l1_expanded(page, l1) -> None:
    """Expand L1 column if currently collapsed (icon-only = width < 100px)."""
    box = l1.bounding_box()
    if box and box["width"] < 100:
        l1.locator("button").first.click()
        page.wait_for_function(
            "() => document.querySelector('aside').getBoundingClientRect().width >= 100",
            timeout=5_000,
        )


def ensure_l1_collapsed(page, l1) -> None:
    """Collapse L1 column if currently expanded."""
    box = l1.bounding_box()
    if box and box["width"] >= 100:
        l1.locator("button").first.click()
        page.wait_for_function(
            "() => document.querySelector('aside').getBoundingClientRect().width < 100",
            timeout=5_000,
        )


def l1_btn(l1, label: str):
    # Sidebar items with routes render as <Link> (role=link); containers render as <button>
    return l1.get_by_role("button", name=label, exact=True).or_(
        l1.get_by_role("link", name=label, exact=True)
    )
