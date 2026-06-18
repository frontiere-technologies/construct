import os
import pytest
from pathlib import Path
from playwright.sync_api import sync_playwright

_env_file = Path(__file__).parent / ".env.test"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())


@pytest.fixture(scope="session")
def base_url():
    return os.getenv("BASE_URL", "http://localhost:3000")


@pytest.fixture(scope="session")
def credentials():
    email = os.getenv("TEST_EMAIL", "")
    password = os.getenv("TEST_PASSWORD", "")
    if not email or not password:
        pytest.exit("Set TEST_EMAIL and TEST_PASSWORD in tests/e2e/.env.test")
    return {"email": email, "password": password}


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def logged_in_page(page, base_url, credentials):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[type="email"]', credentials["email"])
    page.fill('input[type="password"]', credentials["password"])
    page.click('button[type="submit"]')
    page.wait_for_url(f"{base_url}/", timeout=10_000)
    page.wait_for_load_state("networkidle")
    yield page
