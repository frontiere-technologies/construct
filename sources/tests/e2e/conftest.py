import os
import subprocess
import uuid
import warnings
import pytest
from pathlib import Path
from playwright.sync_api import sync_playwright

from helpers import delete_e2e_tenants, delete_people, do_test_login, make_platform_admin, nav, operator_env

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


def _delete_leftover_tenants() -> None:
    # Tenants left by a test_tenants.py run killed halfway (see helpers.delete_e2e_tenants). Before
    # test-reset-e2e, which then clears the last used tenant of the two E2E accounts. Without the
    # owner identity the step is skipped with a warning: the run cannot have created them either.
    if not operator_env():
        warnings.warn("TEST_MIGRATION_DATABASE_URL not available: leftover E2E tenants not checked")
        return
    delete_e2e_tenants()


def _e2e_platform_people() -> list[str]:
    """The accounts the console tests use: the platform administrator and the first admin of the tenant
    the console creates. Their domain is TEST_EMAIL's, like the people of test_tenants.py."""
    domain = os.getenv("TEST_EMAIL", "").split("@", 1)[-1] or "frontiere.io"
    return [f"e2e-platform-admin@{domain}", f"e2e-console-admin@{domain}", f"e2e-console-member@{domain}"]


def _delete_leftover_platform_state() -> None:
    """Platform administrators and the people of the console tenant left by an interrupted run.

    After the tenants (their memberships go with them), before test-reset-e2e. A platform admin left
    behind would be one more account that can open the console on a database the other tests expect
    to have none of those; a left-over tenant also takes its support consent with it. Skipped, like
    the tenants, without the owner identity.
    """
    if operator_env():
        delete_people(_e2e_platform_people())


@pytest.fixture(scope="session", autouse=True)
def clean_language_preferences():
    _require_disposable_test_database()
    _delete_leftover_tenants()
    _delete_leftover_platform_state()
    _reset_language_preferences()
    try:
        yield
    finally:
        try:
            _delete_leftover_tenants()
            _delete_leftover_platform_state()
        except Exception as error:  # noqa: BLE001 - the rest of the teardown still has to run
            warnings.warn(f"console E2E state not cleaned at the end of the session: {error}")
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
        # The 50 ms pause per action is only there to let a human follow a headed run; headless
        # it was ~50 ms × every click, fill and goto of the suite, waiting on nothing.
        b = p.chromium.launch(headless=headless, slow_mo=0 if headless else 50)
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
def logged_in_page(browser, admin_storage_state):
    """Authenticated admin page, reusing the session-scoped login's storage
    state so each test starts a fresh (isolated) but already-logged-in context.

    It stays on about:blank: the test navigates where it needs to. Loading `/`
    here cost a full home render for the ~85 tests that go elsewhere straight
    away; the ones that really start from the home page use `home_page`."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=admin_storage_state)
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def home_page(logged_in_page, base_url):
    """The authenticated admin page on `/`, matching do_test_login's end state:
    for the tests that start from the home page (sidebar, account panel)."""
    nav(logged_in_page, f"{base_url}/")
    return logged_in_page


@pytest.fixture(scope="session")
def platform_admin_email():
    """A platform administrator who belongs to no tenant: the console is theirs and nothing else.

    A dedicated account, not TEST_EMAIL: with the attribute on TEST_EMAIL every other test would
    run as someone who also sees the console (MT5-OK-5). Made through db.mjs, removed by the
    session fixture at the end (and at the start, if a run was interrupted).
    """
    email = _e2e_platform_people()[0]
    make_platform_admin(email)
    return email


@pytest.fixture(scope="session")
def platform_admin_storage_state(browser, base_url, platform_admin_email):
    """The login of the platform administrator: no tenant, so the sign-in ends on the console."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    do_test_login(p, base_url, platform_admin_email, landing="/platform")
    state = ctx.storage_state()
    ctx.close()
    return state


@pytest.fixture
def platform_page(browser, platform_admin_storage_state):
    """Authenticated platform administrator page; stays on about:blank like `logged_in_page`."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=platform_admin_storage_state)
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def non_admin_page(browser, non_admin_storage_state):
    """Authenticated non-admin page, reusing the session-scoped login's storage state.
    Stays on about:blank like `logged_in_page`: the test navigates where it needs to."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=non_admin_storage_state)
    p = ctx.new_page()
    yield p
    ctx.close()
