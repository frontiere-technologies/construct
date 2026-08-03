import os
import subprocess
import uuid
import pytest
from pathlib import Path
from playwright.sync_api import sync_playwright

from helpers import do_test_login, nav

_env_file = Path(__file__).parent / ".env.test"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

REPO_ROOT = Path(__file__).resolve().parents[3]
REGISTER_EMAIL = f"e2e-register-{uuid.uuid4().hex}@frontiere.io"


def _require_disposable_test_database() -> None:
    if not os.getenv("TEST_DATABASE_URL"):
        pytest.exit("Set TEST_DATABASE_URL to a dedicated disposable database in tests/e2e/.env.test")
    if os.getenv("TEST_DATABASE_DISPOSABLE") != "1":
        pytest.exit("Set TEST_DATABASE_DISPOSABLE=1 after verifying the E2E database is disposable")
    if os.getenv("DATABASE_URL") and os.getenv("DATABASE_URL") == os.getenv("TEST_DATABASE_URL"):
        pytest.exit("TEST_DATABASE_URL must be different from DATABASE_URL")


def _reset_language_preferences() -> None:
    # Clear users.id_language so the suite always starts from the default
    # language. The suite asserts Italian copy, and a user left on English
    # fails assertions in unrelated test files with no hint of the real cause.
    subprocess.run(
        ["node", "sources/devops/db/db.mjs", "test-reset-e2e"],
        cwd=REPO_ROOT, check=True, capture_output=True,
    )


@pytest.fixture(scope="session", autouse=True)
def clean_language_preferences():
    _require_disposable_test_database()
    _reset_language_preferences()
    try:
        yield
    finally:
        _reset_language_preferences()
        env = {**os.environ, "E2E_REGISTER_EMAIL": REGISTER_EMAIL}
        subprocess.run(
            ["node", "sources/devops/db/db.mjs", "test-delete-user"],
            cwd=REPO_ROOT, check=True, capture_output=True, env=env,
        )


@pytest.fixture(scope="session")
def registration_email():
    return REGISTER_EMAIL


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


def _login_once(browser, base_url, email):
    """Run the real login flow once and capture the resulting storage state
    (session cookie), so per-test fixtures can start already-authenticated
    contexts instead of repeating the login UI flow for every test."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    do_test_login(p, base_url, email)
    state = ctx.storage_state()
    ctx.close()
    return state


@pytest.fixture(scope="session")
def admin_storage_state(browser, base_url, test_email):
    return _login_once(browser, base_url, test_email)


@pytest.fixture(scope="session")
def non_admin_storage_state(browser, base_url, test_email_user):
    return _login_once(browser, base_url, test_email_user)


@pytest.fixture
def logged_in_page(browser, base_url, admin_storage_state):
    """Authenticated admin page, reusing the session-scoped login's storage
    state so each test starts a fresh (isolated) but already-logged-in context.
    Lands on `/`, matching do_test_login's end state (tests rely on this)."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state)
    p = ctx.new_page()
    nav(p, f"{base_url}/")
    yield p
    ctx.close()


@pytest.fixture
def non_admin_page(browser, base_url, non_admin_storage_state):
    """Authenticated non-admin page, reusing the session-scoped login's storage state.
    Lands on `/`, matching do_test_login's end state (tests rely on this)."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=non_admin_storage_state)
    p = ctx.new_page()
    nav(p, f"{base_url}/")
    yield p
    ctx.close()
