"""E2e tests for the self-registration flow (dedicated /register page)."""
import pytest
from playwright.sync_api import expect
from helpers import nav

REGISTER_CONFIRM = "Se l'email è autorizzata riceverai un link per completare la registrazione."
FORGOT_CONFIRM = "Se l'email è registrata riceverai un link per reimpostare la password."


def test_registrati_link_navigates_to_register_page(page, base_url):
    """Clicking 'Registrati' navigates to /register."""
    nav(page, f"{base_url}/login")
    page.click('text=Registrati')
    page.wait_for_url(f"{base_url}/register")
    assert page.locator('button[type="submit"]:has-text("Registrati")').is_visible()


@pytest.mark.parametrize("start_path", ["/register", "/forgot-password"])
def test_back_link_returns_to_login(page, base_url, start_path):
    """'← Torna al login' returns to /login from both register and forgot-password pages."""
    nav(page, f"{base_url}{start_path}")
    page.click('text=← Torna al login')
    page.wait_for_url(f"{base_url}/login")
    assert page.url == f"{base_url}/login"


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain shows the confirmation message (no info leak)."""
    nav(page, f"{base_url}/register")
    page.locator('input[type="email"]').fill('hacker@notallowed.xyz')
    page.locator('button[type="submit"]').click()
    # Higher timeout: first hit to this API route triggers Next.js dev-mode compilation (~3-5s)
    expect(page.get_by_text(REGISTER_CONFIRM)).to_be_visible(timeout=15_000)


def test_register_authorized_domain_shows_confirmation(page, base_url, registration_email):
    """Submitting an authorized domain shows the confirmation message."""
    nav(page, f"{base_url}/register")
    page.locator('input[type="email"]').fill(registration_email)
    page.locator('button[type="submit"]').click()
    expect(page.get_by_text(REGISTER_CONFIRM)).to_be_visible(timeout=10_000)


def test_forgot_password_link_navigates_to_dedicated_page(page, base_url):
    """Clicking 'Password dimenticata?' navigates to /forgot-password."""
    nav(page, f"{base_url}/login")
    page.click('text=Password dimenticata?')
    page.wait_for_url(f"{base_url}/forgot-password")
    assert page.locator('button[type="submit"]:has-text("Invia link")').is_visible()


def test_forgot_password_submission_shows_confirmation(page, base_url):
    """Submitting any email shows the generic confirmation message (no info leak)."""
    nav(page, f"{base_url}/forgot-password")
    page.locator('input[type="email"]').fill('anyone@frontiere.io')
    page.locator('button[type="submit"]').click()
    # Higher timeout: first hit to this API route triggers Next.js dev-mode compilation (~3-5s)
    expect(page.get_by_text(FORGOT_CONFIRM)).to_be_visible(timeout=15_000)
