"""E2e tests for the self-registration flow (dedicated /register page)."""
import time

import pytest


def test_registrati_link_navigates_to_register_page(page, base_url):
    """Clicking 'Registrati' navigates to /register."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    page.click('text=Registrati')
    page.wait_for_url(f"{base_url}/register")
    assert page.url == f"{base_url}/register"
    assert page.locator('button[type="submit"]:has-text("Registrati")').is_visible()


def test_register_page_back_link_returns_to_login(page, base_url):
    """'← Torna al login' on /register navigates back to /login."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    page.click('text=← Torna al login')
    page.wait_for_url(f"{base_url}/login")
    assert page.url == f"{base_url}/login"


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain shows the confirmation message (no info leak)."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    page.locator('input[type="email"]').fill('hacker@notallowed.xyz')
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.'
    ).is_visible()


def test_register_authorized_domain_shows_confirmation(page, base_url):
    """Submitting an authorized domain shows the confirmation message."""
    page.goto(f"{base_url}/register")
    page.wait_for_load_state("networkidle")

    unique_email = f"register-test-{int(time.time())}@frontiere.io"
    page.locator('input[type="email"]').fill(unique_email)
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è autorizzata riceverai un link per completare la registrazione.'
    ).is_visible()


def test_forgot_password_link_navigates_to_dedicated_page(page, base_url):
    """Clicking 'Password dimenticata?' navigates to /forgot-password."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    page.click('text=Password dimenticata?')
    page.wait_for_url(f"{base_url}/forgot-password")
    assert page.url == f"{base_url}/forgot-password"
    assert page.locator('button[type="submit"]:has-text("Invia link")').is_visible()


def test_forgot_password_back_link_returns_to_login(page, base_url):
    """'← Torna al login' on /forgot-password navigates back to /login."""
    page.goto(f"{base_url}/forgot-password")
    page.wait_for_load_state("networkidle")

    page.click('text=← Torna al login')
    page.wait_for_url(f"{base_url}/login")
    assert page.url == f"{base_url}/login"


def test_forgot_password_submission_shows_confirmation(page, base_url):
    """Submitting any email shows the generic confirmation message (no info leak)."""
    page.goto(f"{base_url}/forgot-password")
    page.wait_for_load_state("networkidle")

    page.locator('input[type="email"]').fill('anyone@frontiere.io')
    page.locator('button[type="submit"]').click()

    page.wait_for_selector(
        'text=Se l\'email è registrata riceverai un link per reimpostare la password.',
        timeout=5000,
    )
    assert page.locator(
        'text=Se l\'email è registrata riceverai un link per reimpostare la password.'
    ).is_visible()
