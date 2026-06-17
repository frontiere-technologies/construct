"""
E2E tests for sidebar menu navigation.

Menu from DB:
  L1 bottom: Support (/support), Admin (container, order 3)
  L2 under Admin: Menu Builder (/admin/menu-builder), Theme & Styles (/admin/theme)

Credentials are loaded from tests/e2e/.env.test (git-ignored).
Copy tests/e2e/.env.test.example → tests/e2e/.env.test and fill in the values.
Env vars can also be passed directly: TEST_EMAIL=... TEST_PASSWORD=... python3 ...
"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

# Load .env.test if present (never committed — see .env.test.example)
_env_file = Path(__file__).parent / ".env.test"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

BASE_URL = os.getenv("BASE_URL", "http://localhost:3000")
TEST_EMAIL = os.getenv("TEST_EMAIL", "")
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "")

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

results: list[tuple[str, bool]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    status = PASS if ok else FAIL
    print(f"  [{status}] {name}" + (f"  ({detail})" if detail else ""))
    results.append((name, ok))


def login(page) -> None:
    page.goto(f"{BASE_URL}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[type="email"]', TEST_EMAIL)
    page.fill('input[type="password"]', TEST_PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url(f"{BASE_URL}/", timeout=10_000)
    page.wait_for_load_state("networkidle")


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


def run_tests() -> None:
    if not TEST_EMAIL or not TEST_PASSWORD:
        print("ERROR: set TEST_EMAIL and TEST_PASSWORD env vars")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # ── 1. Redirect non autenticato → /login ──────────────────────────────
        print("\n── 1. Auth redirect ──")
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        record("Non-autenticato / redirect a /login", "/login" in page.url, page.url)

        # ── 2. Login ──────────────────────────────────────────────────────────
        print("\n── 2. Login ──")
        try:
            login(page)
            record("Login redirige a /", page.url == f"{BASE_URL}/", page.url)
        except Exception as e:
            record("Login redirige a /", False, str(e))
            browser.close()
            return

        page.screenshot(path="/tmp/menu_01_home.png")

        # ── 3. Sidebar presente ───────────────────────────────────────────────
        print("\n── 3. Sidebar presente ──")
        l1 = page.locator("aside").first
        record("L1 aside visibile", l1.is_visible())
        btn_count = l1.locator("button").count()
        record("L1 ha almeno 3 button (toggle + voci + utente)", btn_count >= 3,
               f"{btn_count} buttons")

        # ── 4. Espansione L1 ──────────────────────────────────────────────────
        print("\n── 4. Espansione colonna L1 ──")
        w_collapsed = l1.bounding_box()["width"]
        ensure_l1_expanded(page, l1)
        w_expanded = l1.bounding_box()["width"]
        record("L1 si espande (larghezza aumenta)", w_expanded > w_collapsed,
               f"{w_collapsed:.0f}px → {w_expanded:.0f}px")
        page.screenshot(path="/tmp/menu_02_expanded.png")

        record("'Support' label visibile in L1 espanso",
               l1_btn(l1, "Support").is_visible())
        record("'Admin' label visibile in L1 espanso",
               l1_btn(l1, "Admin").is_visible())

        # ── 5. Navigazione link diretto: Support → /support ──────────────────
        print("\n── 5. Navigazione link diretto ──")
        l1_btn(l1, "Support").click()
        try:
            page.wait_for_url("**/support", timeout=5_000)
            record("Click 'Support' naviga a /support", True, page.url)
        except Exception:
            record("Click 'Support' naviga a /support", False, page.url)
        page.screenshot(path="/tmp/menu_03_support.png")

        # ── 6. Sidebar persiste dopo navigazione ─────────────────────────────
        print("\n── 6. Sidebar persiste dopo navigazione ──")
        record("Sidebar ancora presente su /support", l1.is_visible())
        record("L1 ancora espanso dopo navigazione",
               l1.bounding_box()["width"] >= 100)

        # ── 7. Contenitore Admin → colonna L2 ────────────────────────────────
        print("\n── 7. Contenitore Admin → colonna L2 ──")
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        # l1 reference still valid (same aside), ensure expanded
        ensure_l1_expanded(page, l1)

        l1_btn(l1, "Admin").click()
        page.wait_for_timeout(400)
        page.screenshot(path="/tmp/menu_04_admin_l2.png")

        aside_count = page.locator("aside").count()
        record("Colonna L2 appare dopo click 'Admin'",
               aside_count >= 2, f"{aside_count} colonne")

        l2 = page.locator("aside").nth(1)
        record("'Menu Builder' visibile in L2",
               l2.get_by_text("Menu Builder").is_visible())
        record("'Theme & Styles' visibile in L2",
               l2.get_by_text("Theme & Styles").is_visible())

        # ── 8. Navigazione link L2 ────────────────────────────────────────────
        print("\n── 8. Navigazione link L2 ──")
        l2.get_by_text("Menu Builder").click()
        try:
            page.wait_for_url("**/admin/menu-builder", timeout=5_000)
            record("Click 'Menu Builder' naviga a /admin/menu-builder", True, page.url)
        except Exception:
            record("Click 'Menu Builder' naviga a /admin/menu-builder", False, page.url)
        page.screenshot(path="/tmp/menu_05_menu_builder.png")

        # Navigate back, reopen Admin, click Theme & Styles
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        ensure_l1_expanded(page, l1)
        l1_btn(l1, "Admin").click()
        page.wait_for_timeout(400)

        l2 = page.locator("aside").nth(1)
        l2.get_by_text("Theme & Styles").click()
        try:
            page.wait_for_url("**/admin/theme", timeout=5_000)
            record("Click 'Theme & Styles' naviga a /admin/theme", True, page.url)
        except Exception:
            record("Click 'Theme & Styles' naviga a /admin/theme", False, page.url)

        # ── 9. Chiusura L2: secondo click su Admin ────────────────────────────
        print("\n── 9. Chiusura colonna L2 ──")
        ensure_l1_expanded(page, l1)
        # If Admin is already selected, L2 is showing → click to deselect
        l1_btn(l1, "Admin").click()
        page.wait_for_timeout(400)
        asides_after = page.locator("aside").count()
        record("L2 scompare dopo deselect 'Admin'",
               asides_after < 2, f"{asides_after} colonne")

        # ── 10. Collasso L1 ───────────────────────────────────────────────────
        print("\n── 10. Collasso colonna L1 ──")
        ensure_l1_expanded(page, l1)
        w_before = l1.bounding_box()["width"]
        ensure_l1_collapsed(page, l1)
        w_after = l1.bounding_box()["width"]
        record("L1 si restringe dopo collasso", w_after < w_before,
               f"{w_before:.0f}px → {w_after:.0f}px")
        page.screenshot(path="/tmp/menu_07_collapsed.png")

        # ── 11. Active route highlight ────────────────────────────────────────
        print("\n── 11. Active route highlight ──")
        page.goto(f"{BASE_URL}/admin/menu-builder")
        page.wait_for_load_state("networkidle")
        ensure_l1_expanded(page, l1)
        page.screenshot(path="/tmp/menu_06_active_route.png")
        ring_items = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
        record("Route attiva ha highlight ring-primary",
               len(ring_items) > 0, f"{ring_items}")
        record("Esattamente Admin + Menu Builder evidenziati su /admin/menu-builder",
               set(ring_items) == {"Admin", "Menu Builder"},
               f"trovati: {ring_items}")

        # ── 12. No doppio highlight: su /support + espandi Admin ──────────────
        print("\n── 12. No doppio highlight (regression test) ──")
        page.goto(f"{BASE_URL}/support")
        page.wait_for_load_state("networkidle")
        ensure_l1_expanded(page, l1)

        # Only Support should be highlighted (active route)
        ring_on_support = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
        record("Su /support solo 'Support' ha ring-primary",
               ring_on_support == ["Support"], f"trovati: {ring_on_support}")

        # Now expand Admin while on /support — Admin must NOT gain ring-primary
        l1_btn(l1, "Admin").click()
        page.wait_for_timeout(400)
        page.screenshot(path="/tmp/menu_08_support_admin_open.png")

        ring_after_admin_expand = [el.inner_text().strip() for el in page.locator("[class*='ring-primary']").all()]
        record("Su /support + Admin espanso: solo 'Support' ha ring-primary (no doppio highlight)",
               ring_after_admin_expand == ["Support"],
               f"trovati: {ring_after_admin_expand}")

        # ── 13. Menu Builder: aggiunta e rimozione di TEST-ITEM ───────────────
        print("\n── 13. Admin Menu Builder — add/delete item ──")
        page.goto(f"{BASE_URL}/admin/menu-builder")
        page.wait_for_load_state("networkidle")

        # Apri form nuovo item
        page.get_by_role("button", name="Add Item").click()
        page.wait_for_timeout(300)

        # Compila Label
        label_input = page.locator('form input[type="text"]').first
        label_input.fill("TEST-ITEM")

        # Position = main
        page.locator('form select').nth(1).select_option("main")

        # Route
        page.locator('form input[type="text"]').nth(1).fill("/test-item")

        page.screenshot(path="/tmp/menu_09_add_form_filled.png")

        # Salva
        page.get_by_role("button", name="Save Changes").click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="/tmp/menu_10_after_add.png")

        # Verifica che TEST-ITEM appaia nella lista (sezione Main Navigation)
        item_row = page.locator(".flex.items-center.justify-between", has_text="TEST-ITEM")
        record("TEST-ITEM appare nella lista dopo il salvataggio",
               item_row.count() > 0, f"{item_row.count()} righe trovate")

        # Verifica che il bottone delete (rosso) sia presente per l'item non-protetto
        delete_btn = item_row.locator("button[class*='text-red-600']")
        record("Bottone delete presente per TEST-ITEM",
               delete_btn.count() > 0)

        # Accetta il confirm dialog e clicca delete
        page.on("dialog", lambda d: d.accept())
        delete_btn.first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="/tmp/menu_11_after_delete.png")

        # Verifica che TEST-ITEM sia sparito dalla lista
        remaining = page.locator(".flex.items-center.justify-between", has_text="TEST-ITEM").count()
        record("TEST-ITEM rimosso dalla lista dopo delete",
               remaining == 0, f"{remaining} righe rimaste")

        # ── 14. Pagina Profile — navigazione, form, persistenza ──────────────
        print("\n── 14. Profile page — navigazione, form, persistenza ──")

        # Vai alla home e apri il pannello utente via sidebar
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        ensure_l1_expanded(page, l1)

        # Il bottone utente è l'ultimo button nella colonna L1
        # (contiene l'email dell'utente come testo)
        user_panel_btn = l1.locator(f"button:has-text('{TEST_EMAIL}')")
        user_panel_btn.click()
        page.wait_for_timeout(400)

        # Colonna L2 del pannello utente
        l2_user = page.locator("aside").nth(1)
        l2_user.get_by_text("Profile").click()
        try:
            page.wait_for_url("**/profile", timeout=5_000)
            record("Click 'Profile' naviga a /profile", True, page.url)
        except Exception:
            record("Click 'Profile' naviga a /profile", False, page.url)
        page.screenshot(path="/tmp/profile_01_page.png")

        # Campo email presente e non editabile
        email_input = page.locator('input[type="email"]')
        record("Campo email visibile su /profile", email_input.is_visible())
        record("Campo email è read-only (disabled)",
               not email_input.is_enabled())

        # Quattro campi editabili presenti (text + tel)
        editable = page.locator('input[type="text"], input[type="tel"]')
        record("Almeno 4 campi editabili presenti su /profile",
               editable.count() >= 4, f"{editable.count()} input trovati")

        # Compila first name e salva
        first_name_input = page.locator('input[type="text"]').first
        first_name_input.fill("E2E Test User")
        page.get_by_role("button", name="Save Profile").click()
        page.wait_for_timeout(1_000)
        page.screenshot(path="/tmp/profile_02_saved.png")

        record("Messaggio 'Profile saved.' appare dopo salvataggio",
               page.locator("text=Profile saved.").is_visible())

        # Verifica persistenza dopo reload
        page.reload()
        page.wait_for_load_state("networkidle")
        reloaded_value = page.locator('input[type="text"]').first.input_value()
        record("First name persiste dopo reload della pagina",
               reloaded_value == "E2E Test User",
               f"valore: '{reloaded_value}'")

        # Cleanup: svuota first name e salva
        page.locator('input[type="text"]').first.fill("")
        page.get_by_role("button", name="Save Profile").click()
        page.wait_for_timeout(1_000)
        record("Cleanup: first name svuotato e salvato",
               page.locator("text=Profile saved.").is_visible())

        browser.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print("\n── Riepilogo ─────────────────────────────────────────────────────")
    for name, ok in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"\n  {passed}/{total} test superati")
    print("  Screenshot: /tmp/menu_0*.png  /tmp/menu_07_collapsed.png  /tmp/profile_0*.png")
    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
