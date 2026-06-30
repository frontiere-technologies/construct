import os
import pytest
from pathlib import Path
from playwright.sync_api import sync_playwright

from helpers import do_test_login

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
def test_email():
    email = os.getenv("TEST_EMAIL", "")
    if not email:
        pytest.exit("Set TEST_EMAIL in tests/e2e/.env.test")
    return email


@pytest.fixture(scope="session")
def test_email_user():
    email = os.getenv("TEST_EMAIL_USER", "")
    if not email:
        pytest.skip("Set TEST_EMAIL_USER in .env.test to run non-admin tests")
    return email


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        headless = os.getenv("HEADLESS", "true").lower() == "true"
        b = p.chromium.launch(headless=headless, slow_mo=50)
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def logged_in_page(page, base_url, test_email):
    """Authenticated admin page."""
    do_test_login(page, base_url, test_email)
    yield page


@pytest.fixture
def non_admin_page(page, base_url, test_email_user):
    """Authenticated non-admin page."""
    do_test_login(page, base_url, test_email_user)
    yield page
